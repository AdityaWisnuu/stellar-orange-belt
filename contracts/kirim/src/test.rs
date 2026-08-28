#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::{StellarAssetClient, TokenClient},
    Address, Env, String,
};

struct Setup<'a> {
    env: Env,
    kirim: KirimClient<'a>,
    token: TokenClient<'a>,
    sender: Address,
    recipient: Address,
}

fn setup() -> Setup<'static> {
    let env = Env::default();
    env.mock_all_auths();

    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);

    let asset = env.register_stellar_asset_contract_v2(Address::generate(&env));
    let token = TokenClient::new(&env, &asset.address());
    StellarAssetClient::new(&env, &asset.address()).mint(&sender, &1_000_0000000);

    let contract_id = env.register(Kirim, (&asset.address(),));
    let kirim = KirimClient::new(&env, &contract_id);
    Setup {
        env,
        kirim,
        token,
        sender,
        recipient,
    }
}

fn send(s: &Setup, amount: i128, ttl: u32) -> u64 {
    s.kirim.send(
        &s.sender,
        &s.recipient,
        &amount,
        &String::from_str(&s.env, "buat keluarga di rumah"),
        &ttl,
    )
}

#[test]
fn send_locks_funds_and_claim_releases_them_to_recipient() {
    let s = setup();
    let id = send(&s, 250_0000000, 100);

    assert_eq!(id, 0);
    assert_eq!(s.token.balance(&s.sender), 750_0000000);
    assert_eq!(s.token.balance(&s.kirim.address), 250_0000000);

    s.kirim.claim(&id);
    assert_eq!(s.token.balance(&s.recipient), 250_0000000);
    assert_eq!(s.token.balance(&s.kirim.address), 0);
    assert_eq!(s.kirim.get_transfer(&id).status, Status::Claimed);
    assert_eq!(s.kirim.count(), 1);
}

#[test]
fn refund_after_expiry_returns_funds_to_sender() {
    let s = setup();
    let id = send(&s, 100_0000000, 50);

    // maju melewati expiry
    s.env.ledger().with_mut(|l| l.sequence_number += 51);
    s.kirim.refund(&id);

    assert_eq!(s.token.balance(&s.sender), 1_000_0000000);
    assert_eq!(s.kirim.get_transfer(&id).status, Status::Refunded);
}

#[test]
fn claim_after_expiry_is_rejected() {
    let s = setup();
    let id = send(&s, 100_0000000, 50);
    s.env.ledger().with_mut(|l| l.sequence_number += 51);
    assert_eq!(s.kirim.try_claim(&id), Err(Ok(Error::Expired)));
}

#[test]
fn refund_before_expiry_is_rejected() {
    let s = setup();
    let id = send(&s, 100_0000000, 50);
    assert_eq!(s.kirim.try_refund(&id), Err(Ok(Error::NotExpiredYet)));
}

#[test]
fn double_claim_is_rejected() {
    let s = setup();
    let id = send(&s, 100_0000000, 100);
    s.kirim.claim(&id);
    assert_eq!(s.kirim.try_claim(&id), Err(Ok(Error::NotPending)));
    assert_eq!(s.kirim.try_refund(&id), Err(Ok(Error::NotPending)));
}

#[test]
fn invalid_inputs_are_rejected() {
    let s = setup();
    assert_eq!(
        s.kirim.try_send(
            &s.sender,
            &s.recipient,
            &0,
            &String::from_str(&s.env, "x"),
            &100
        ),
        Err(Ok(Error::InvalidAmount))
    );
    assert_eq!(
        s.kirim.try_send(
            &s.sender,
            &s.recipient,
            &10,
            &String::from_str(&s.env, "x"),
            &1
        ),
        Err(Ok(Error::InvalidTtl))
    );
    assert_eq!(s.kirim.try_claim(&99), Err(Ok(Error::NotFound)));
}
