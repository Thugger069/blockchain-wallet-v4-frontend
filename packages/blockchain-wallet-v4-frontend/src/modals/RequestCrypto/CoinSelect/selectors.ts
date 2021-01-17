import { map } from 'ramda'
import Bitcoin from 'bitcoinjs-lib'
import BitcoinCash from 'bitcoinforksjs-lib'

import { ADDRESS_TYPES } from 'blockchain-wallet-v4/src/redux/payment/btc/utils'
import { CoinAccountSelectorType, REQUEST_SELECTOR_CONFIG } from 'coins'
import { createDeepEqualSelector } from 'services/misc'
import { selectors } from 'data'
import { SwapAccountType } from 'data/components/swap/types'
import { utils } from 'blockchain-wallet-v4/src'

const { isCashAddr, toCashAddr } = utils.bch

export const getData = createDeepEqualSelector(
  [
    (state, ownProps) => selectors.components.swap.getActiveAccounts(state, {
      coins: ownProps.requestableCoins,
      ...REQUEST_SELECTOR_CONFIG
    } as CoinAccountSelectorType),
    selectors.core.walletOptions.getAllCoinAvailabilities,
    selectors.core.walletOptions.getBtcNetwork,
    (state, ownProps) => ({ ownProps, state })
  ],
  (accounts, coinAvailabilitiesR, btcNetworkR, { ownProps, state }) => {
    const { selectedCoin } = ownProps?.formValues || {}
    const coinAvailabilities = coinAvailabilitiesR.getOrFail()
    const btcNetwork = btcNetworkR.getOrElse('bitcoin')
    const prunedAccounts = [] as Array<SwapAccountType>

    map(
      coin =>
        map(acct => {
          // remove account if any if either of following are true
          // - coin receive feature is currently disabled
          // - form has a selected coin and it doesnt match accounts coin type
          if (selectedCoin === 'ALL' ? coinAvailabilities[acct.coin].request : acct.coin === selectedCoin) {
            // if HD account type and coin is BTC, derive next address
            if (acct.type === ADDRESS_TYPES.ACCOUNT && acct.coin === 'BTC') {
              acct.nextReceiveAddress = selectors.core.common.btc.getNextAvailableReceiveAddress(
                Bitcoin.networks[btcNetwork],
                acct.accountIndex,
                state
              ).getOrFail()
            }
            // if HD account type and coin is BCH, derive next address
            if (acct.type === ADDRESS_TYPES.ACCOUNT && acct.coin === 'BCH') {
              const nextBchAddress = selectors.core.common.bch.getNextAvailableReceiveAddress(
                BitcoinCash.networks[btcNetwork],
                acct.accountIndex,
                state
              ).getOrFail()

              acct.nextReceiveAddress = isCashAddr(nextBchAddress)
                ? nextBchAddress
                : toCashAddr(nextBchAddress, true)
            }
            prunedAccounts.push(acct)
          }
        }, coin),
      accounts
    )

    return prunedAccounts
  }
)
