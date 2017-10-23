import Bitcoin from 'bitcoinjs-lib'
import BitcoinMessage from 'bitcoinjs-message'
import BIP39 from 'bip39'
import { assoc, curry, compose, prop, is } from 'ramda'
import { traversed, traverseOf, over, view, set } from 'ramda-lens'
import Either from 'data.either'
import * as crypto from '../walletCrypto'
import Type from './Type'
// import { shift, shiftIProp } from './util'


/*
Payload types:
0: reserved (guid)
1: reserved
2: whatsNew
3: buy-sell
4: contacts
*/

export class KVStoreEntry extends Type {
  // toString () {
  //   return `KV(${this.typeId} | ${this.address} | ${JSON.stringify(this.value, null, 2)})`
  // }
}
export const isKVStoreEntry = is(KVStoreEntry)

export const VERSION = KVStoreEntry.define('VERSION')
export const typeId = KVStoreEntry.define('typeId')
export const magicHash = KVStoreEntry.define('magicHash')
export const address = KVStoreEntry.define('address')
export const signKey = KVStoreEntry.define('signKey')
export const encKeyBuffer = KVStoreEntry.define('encKeyBuffer')
export const value = KVStoreEntry.define('value')

export const selectVERSION = view(VERSION)
export const selectTypeId = view(typeId)
export const selectMagicHash = view(magicHash)
export const selectAddress = view(address)
export const selectSignKey = view(signKey)
export const selectEncKeyBuffer = view(encKeyBuffer)
export const selectValue = view(value)

export const reviver = (jsObject) => {
  return new KVStoreEntry(jsObject)
}

export const createEmpty = (typeId) => {
  return new KVStoreEntry({ VERSION: 1, typeId })
}

export const fromMetadataHDNode = curry((metadataHDNode, typeId) => {
  let payloadTypeNode = metadataHDNode.deriveHardened(typeId)
  let node = payloadTypeNode.deriveHardened(0)
  let privateKeyBuffer = payloadTypeNode.deriveHardened(1).keyPair.d.toBuffer()
  let encryptionKey = crypto.sha256(privateKeyBuffer)
  return new KVStoreEntry({
    VERSION: 1,
    typeId,
    magicHash: null,
    address: node.keyPair.getAddress(),
    signKey: node.keyPair.toWIF(),
    encKeyBuffer: encryptionKey,
    value: void 0
  })
})

export const deriveMetadataNode = (masterHDNode) => {
  // BIP 43 purpose needs to be 31 bit or less. For lack of a BIP number
  // we take the first 31 bits of the SHA256 hash of a reverse domain.
  let hash = crypto.sha256('info.blockchain.metadata')
  let purpose = hash.slice(0, 4).readUInt32BE(0) & 0x7FFFFFFF // 510742
  return masterHDNode.deriveHardened(purpose)
}

export const fromMasterHDNode = curry((masterHDNode, typeId) => {
  let metadataHDNode = deriveMetadataNode(masterHDNode)
  return fromMetadataHDNode(metadataHDNode, typeId)
})

export const fromHdWallet = curry((hdWallet, typeId) => {
  const mnemonic = BIP39.entropyToMnemonic(hdWallet.seedHex)
  const masterhex = BIP39.mnemonicToSeed(mnemonic)
  const masterHdNode = Bitcoin.HDNode.fromSeedBuffer(masterhex)
  return fromMasterHDNode(masterHdNode, typeId)
})

export const encrypt = curry((key, data) => crypto.encryptDataWithKey(data, key, null))
export const decrypt = curry((key, data) => crypto.decryptDataWithKey(data, key))
export const B64ToBuffer = (base64) => Buffer.from(base64, 'base64')
export const BufferToB64 = (buff) => buff.toString('base64')
export const StringToBuffer = (base64) => Buffer.from(base64)
export const BufferToString = (buff) => buff.toString()

// message :: Buffer -> Buffer -> Base64String
export const message = curry((payload, prevMagic) => {
  if (prevMagic) {
    const hash = crypto.sha256(payload)
    const buff = Buffer.concat([prevMagic, hash])
    return buff.toString('base64')
  } else {
    return payload.toString('base64')
  }
})

// magic :: Buffer -> Buffer -> Buffer
export const magic = curry((payload, prevMagic) => {
  let msg = message(payload, prevMagic)
  return BitcoinMessage.magicHash(msg, Bitcoin.networks.bitcoin.messagePrefix)
})

export const verify = curry((address, signature, hash) =>
  BitcoinMessage.verify(hash, address, signature)
)

// sign :: keyPair -> msg -> Buffer
export const sign = curry((keyPair, msg) =>
  BitcoinMessage.sign(msg, keyPair.d.toBuffer(32), keyPair.compressed)
)

// computeSignature :: keypair -> buffer -> buffer -> base64
export const computeSignature = curry((keyWIF, payloadBuff, magicHash) => {
  const key = Bitcoin.ECPair.fromWIF(keyWIF)
  return sign(key, message(payloadBuff, magicHash))
})

export const verifyResponse = curry((address, res) => {
  if (res === null) return Either.of(res)
  let sB = res.signature ? Buffer.from(res.signature, 'base64') : undefined
  let pB = res.payload ? Buffer.from(res.payload, 'base64') : undefined
  let mB = res.prev_magic_hash ? Buffer.from(res.prev_magic_hash, 'hex') : undefined
  let verified = verify(address, sB, message(pB, mB))
  if (!verified) return Either.Left(new Error('METADATA_SIGNATURE_VERIFICATION_ERROR'))
  return Either.of(assoc('compute_new_magic_hash', magic(pB, mB), res))
})

export const extractResponse = curry((encKey, res) => {
  if (res === null) {
    return res
  } else {
    return encKey
      ? compose(JSON.parse, decrypt(encKey), prop('payload'))(res)
      : compose(JSON.parse, BufferToString, B64ToBuffer, prop('payload'))(res)
  }
})
