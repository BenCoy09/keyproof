//! KeyProof guard: a spending guard for an AI agent.
//!
//! The human owner funds this contract. The agent's account holds only a
//! function call key that can call `spend` on this contract, nothing else.
//! `spend` pays out only to allowlisted accounts and only up to a daily cap.
//! A call that breaks a rule panics, so the whole transaction reverts and no
//! NEAR moves.
//!
//! Testnet only. Not audited.

use near_sdk::json_types::U128;
use near_sdk::{env, near, require, AccountId, NearToken, PanicOnDefault, Promise};

const DAY_NS: u64 = 86_400_000_000_000;
/// Extra NEAR the guard always keeps on top of its storage cost (0.1 NEAR).
const SAFETY_YOCTO: u128 = 100_000_000_000_000_000_000_000;

#[near(serializers = [json])]
pub struct PolicyView {
    pub owner: AccountId,
    pub agent: AccountId,
    pub daily_cap_yocto: U128,
    pub pay_to: Vec<AccountId>,
    pub spent_today_yocto: U128,
    pub window_day: u64,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Guard {
    owner: AccountId,
    agent: AccountId,
    daily_cap_yocto: u128,
    pay_to: Vec<AccountId>,
    window_day: u64,
    spent_today_yocto: u128,
}

fn day_index() -> u64 {
    env::block_timestamp() / DAY_NS
}

#[near]
impl Guard {
    #[init]
    pub fn new(owner: AccountId, agent: AccountId, daily_cap_yocto: U128, pay_to: Vec<AccountId>) -> Self {
        Self {
            owner,
            agent,
            daily_cap_yocto: daily_cap_yocto.0,
            pay_to,
            window_day: day_index(),
            spent_today_yocto: 0,
        }
    }

    /// Called by the agent. Pays `amount_yocto` to `to` if every rule holds.
    pub fn spend(&mut self, to: AccountId, amount_yocto: U128) -> Promise {
        require!(env::predecessor_account_id() == self.agent, "only the agent may spend");
        require!(self.pay_to.contains(&to), "recipient is not on the allowlist");
        require!(amount_yocto.0 > 0, "amount must be above zero");

        let today = day_index();
        if today != self.window_day {
            self.window_day = today;
            self.spent_today_yocto = 0;
        }
        let total = self
            .spent_today_yocto
            .checked_add(amount_yocto.0)
            .unwrap_or_else(|| env::panic_str("amount overflow"));
        require!(total <= self.daily_cap_yocto, "daily cap exceeded");

        let locked = env::storage_usage() as u128 * env::storage_byte_cost().as_yoctonear();
        let needed = amount_yocto.0.saturating_add(locked).saturating_add(SAFETY_YOCTO);
        require!(env::account_balance().as_yoctonear() >= needed, "guard balance too low");

        self.spent_today_yocto = total;
        Promise::new(to).transfer(NearToken::from_yoctonear(amount_yocto.0))
    }

    /// Read the policy this guard enforces. KeyProof reads this.
    pub fn get_policy(&self) -> PolicyView {
        let spent = if day_index() == self.window_day { self.spent_today_yocto } else { 0 };
        PolicyView {
            owner: self.owner.clone(),
            agent: self.agent.clone(),
            daily_cap_yocto: U128(self.daily_cap_yocto),
            pay_to: self.pay_to.clone(),
            spent_today_yocto: U128(spent),
            window_day: self.window_day,
        }
    }

    // ---- owner only ----

    pub fn set_daily_cap(&mut self, daily_cap_yocto: U128) {
        self.assert_owner();
        self.daily_cap_yocto = daily_cap_yocto.0;
    }

    pub fn set_pay_to(&mut self, pay_to: Vec<AccountId>) {
        self.assert_owner();
        self.pay_to = pay_to;
    }

    pub fn set_agent(&mut self, agent: AccountId) {
        self.assert_owner();
        self.agent = agent;
    }

    /// Lets the owner take funds back out.
    pub fn withdraw(&mut self, to: AccountId, amount_yocto: U128) -> Promise {
        self.assert_owner();
        Promise::new(to).transfer(NearToken::from_yoctonear(amount_yocto.0))
    }

    fn assert_owner(&self) {
        require!(env::predecessor_account_id() == self.owner, "only the owner may change the policy");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::testing_env;

    const ONE_NEAR: u128 = 1_000_000_000_000_000_000_000_000;

    fn acct(s: &str) -> AccountId {
        s.parse().unwrap()
    }

    fn as_caller(caller: &str, ts_ns: u64) {
        testing_env!(VMContextBuilder::new()
            .predecessor_account_id(acct(caller))
            .block_timestamp(ts_ns)
            .account_balance(NearToken::from_near(50))
            .build());
    }

    fn new_guard() -> Guard {
        as_caller("owner.testnet", 0);
        Guard::new(acct("owner.testnet"), acct("agent.testnet"), U128(2 * ONE_NEAR), vec![acct("owner.testnet")])
    }

    #[test]
    fn agent_can_spend_within_cap() {
        let mut g = new_guard();
        as_caller("agent.testnet", 0);
        let _ = g.spend(acct("owner.testnet"), U128(ONE_NEAR));
        assert_eq!(g.get_policy().spent_today_yocto.0, ONE_NEAR);
    }

    #[test]
    #[should_panic(expected = "daily cap exceeded")]
    fn spending_past_the_cap_is_rejected() {
        let mut g = new_guard();
        as_caller("agent.testnet", 0);
        let _ = g.spend(acct("owner.testnet"), U128(ONE_NEAR));
        let _ = g.spend(acct("owner.testnet"), U128(ONE_NEAR + ONE_NEAR / 2));
    }

    #[test]
    #[should_panic(expected = "recipient is not on the allowlist")]
    fn unlisted_recipient_is_rejected() {
        let mut g = new_guard();
        as_caller("agent.testnet", 0);
        let _ = g.spend(acct("stranger.testnet"), U128(ONE_NEAR / 10));
    }

    #[test]
    #[should_panic(expected = "only the agent may spend")]
    fn only_the_agent_may_spend() {
        let mut g = new_guard();
        as_caller("stranger.testnet", 0);
        let _ = g.spend(acct("owner.testnet"), U128(ONE_NEAR / 10));
    }

    #[test]
    #[should_panic(expected = "only the owner may change the policy")]
    fn the_agent_cannot_change_the_cap() {
        let mut g = new_guard();
        as_caller("agent.testnet", 0);
        g.set_daily_cap(U128(1_000 * ONE_NEAR));
    }

    #[test]
    fn the_cap_resets_on_the_next_day() {
        let mut g = new_guard();
        as_caller("agent.testnet", 0);
        let _ = g.spend(acct("owner.testnet"), U128(2 * ONE_NEAR));
        as_caller("agent.testnet", DAY_NS + 1);
        let _ = g.spend(acct("owner.testnet"), U128(ONE_NEAR));
        assert_eq!(g.get_policy().spent_today_yocto.0, ONE_NEAR);
    }
}
