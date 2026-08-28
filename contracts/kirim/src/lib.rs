#![no_std]
//! KIRIM — escrow remittance sederhana di Stellar.
//! Pengirim mengunci dana ke kontrak; penerima meng-claim sebelum kedaluwarsa;
//! lewat batas waktu, pengirim bisa refund. Setiap perubahan status memancarkan event.
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, token, Address, Env, String,
};

#[contracttype]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Status {
    Pending = 0,
    Claimed = 1,
    Refunded = 2,
}

#[contracttype]
#[derive(Clone)]
pub struct Transfer {
    pub sender: Address,
    pub recipient: Address,
    pub amount: i128,
    pub memo: String,
    pub expiry_ledger: u32,
    pub status: Status,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Token,
    Count,
    Transfer(u64),
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum Error {
    InvalidAmount = 1,
    InvalidTtl = 2,
    NotFound = 3,
    NotPending = 4,
    Expired = 5,
    NotExpiredYet = 6,
}

// ~5 detik per ledger: batasi masa berlaku transfer 1 menit s.d. ±30 hari.
const MIN_TTL_LEDGERS: u32 = 12;
const MAX_TTL_LEDGERS: u32 = 518_400;
// Perpanjang umur storage transfer aktif sampai ±60 hari.
const STORAGE_TTL_LEDGERS: u32 = 1_036_800;

#[contract]
pub struct Kirim;

#[contractimpl]
impl Kirim {
    /// Token yang ditransaksikan (native XLM lewat Stellar Asset Contract).
    pub fn __constructor(env: Env, token: Address) {
        env.storage().instance().set(&DataKey::Token, &token);
        env.storage().instance().set(&DataKey::Count, &0u64);
    }

    /// Kunci `amount` dari `sender` untuk `recipient`. Mengembalikan id transfer.
    pub fn send(
        env: Env,
        sender: Address,
        recipient: Address,
        amount: i128,
        memo: String,
        ttl_ledgers: u32,
    ) -> Result<u64, Error> {
        sender.require_auth();
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        if !(MIN_TTL_LEDGERS..=MAX_TTL_LEDGERS).contains(&ttl_ledgers) {
            return Err(Error::InvalidTtl);
        }

        let token_id: Address = env.storage().instance().get(&DataKey::Token).unwrap();
        token::Client::new(&env, &token_id).transfer(
            &sender,
            &env.current_contract_address(),
            &amount,
        );

        let id: u64 = env.storage().instance().get(&DataKey::Count).unwrap();
        let transfer = Transfer {
            sender: sender.clone(),
            recipient: recipient.clone(),
            amount,
            memo,
            expiry_ledger: env.ledger().sequence() + ttl_ledgers,
            status: Status::Pending,
        };
        let key = DataKey::Transfer(id);
        env.storage().persistent().set(&key, &transfer);
        env.storage()
            .persistent()
            .extend_ttl(&key, STORAGE_TTL_LEDGERS, STORAGE_TTL_LEDGERS);
        env.storage().instance().set(&DataKey::Count, &(id + 1));

        env.events()
            .publish((symbol_short!("kirim"), symbol_short!("sent"), id), (sender, recipient, amount));
        Ok(id)
    }

    /// Penerima menarik dana sebelum kedaluwarsa.
    pub fn claim(env: Env, id: u64) -> Result<(), Error> {
        let key = DataKey::Transfer(id);
        let mut t: Transfer = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(Error::NotFound)?;
        t.recipient.require_auth();
        if t.status != Status::Pending {
            return Err(Error::NotPending);
        }
        if env.ledger().sequence() > t.expiry_ledger {
            return Err(Error::Expired);
        }

        let token_id: Address = env.storage().instance().get(&DataKey::Token).unwrap();
        token::Client::new(&env, &token_id).transfer(
            &env.current_contract_address(),
            &t.recipient,
            &t.amount,
        );
        t.status = Status::Claimed;
        env.storage().persistent().set(&key, &t);

        env.events()
            .publish((symbol_short!("kirim"), symbol_short!("claimed"), id), (t.recipient, t.amount));
        Ok(())
    }

    /// Pengirim menarik kembali dana setelah lewat kedaluwarsa.
    pub fn refund(env: Env, id: u64) -> Result<(), Error> {
        let key = DataKey::Transfer(id);
        let mut t: Transfer = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(Error::NotFound)?;
        t.sender.require_auth();
        if t.status != Status::Pending {
            return Err(Error::NotPending);
        }
        if env.ledger().sequence() <= t.expiry_ledger {
            return Err(Error::NotExpiredYet);
        }

        let token_id: Address = env.storage().instance().get(&DataKey::Token).unwrap();
        token::Client::new(&env, &token_id).transfer(
            &env.current_contract_address(),
            &t.sender,
            &t.amount,
        );
        t.status = Status::Refunded;
        env.storage().persistent().set(&key, &t);

        env.events()
            .publish((symbol_short!("kirim"), symbol_short!("refunded"), id), (t.sender, t.amount));
        Ok(())
    }

    pub fn get_transfer(env: Env, id: u64) -> Result<Transfer, Error> {
        env.storage()
            .persistent()
            .get(&DataKey::Transfer(id))
            .ok_or(Error::NotFound)
    }

    pub fn count(env: Env) -> u64 {
        env.storage().instance().get(&DataKey::Count).unwrap()
    }
}

mod test;
