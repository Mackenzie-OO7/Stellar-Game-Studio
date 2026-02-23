import { Buffer } from "buffer";
import { Address } from "@stellar/stellar-sdk";
import {
  AssembledTransaction,
  Client as ContractClient,
  ClientOptions as ContractClientOptions,
  MethodOptions,
  Result,
  Spec as ContractSpec,
} from "@stellar/stellar-sdk/contract";
import type {
  u32,
  i32,
  u64,
  i64,
  u128,
  i128,
  u256,
  i256,
  Option,
  Timepoint,
  Duration,
} from "@stellar/stellar-sdk/contract";
export * from "@stellar/stellar-sdk";
export * as contract from "@stellar/stellar-sdk/contract";
export * as rpc from "@stellar/stellar-sdk/rpc";

if (typeof window !== "undefined") {
  //@ts-ignore Buffer exists
  window.Buffer = window.Buffer || Buffer;
}


export const networks = {
  testnet: {
    networkPassphrase: "Test SDF Network ; September 2015",
    contractId: "CDIHOSNLTLDHUNLEKV4XTT7FMJJ5327ZYX4E2GZYMYXID4WU4Z6GZS5U",
  }
} as const

export const Errors = {
  1: {message:"GameNotFound"},
  2: {message:"NotPlayer"},
  3: {message:"NotYourTurn"},
  4: {message:"GameNotActive"},
  5: {message:"GameAlreadyStarted"},
  6: {message:"BoardAlreadySet"},
  7: {message:"NoPendingRoll"},
  8: {message:"RollAlreadyPending"},
  9: {message:"InvalidDestination"},
  10: {message:"ProofVerificationFailed"},
  11: {message:"BoardsNotReady"},
  12: {message:"GameAlreadyEnded"},
  13: {message:"InvalidSnakeCount"}
}

export type DataKey = {tag: "Game", values: readonly [u32]} | {tag: "Admin", values: void} | {tag: "GameHubAddress", values: void} | {tag: "VerifierAddress", values: void};


export interface GameState {
  /**
 * Hash of P1's traps (these affect P2)
 */
p1_board_hash: Buffer;
  p1_position: u32;
  /**
 * true = P1's turn, false = P2's turn
 */
p1_turn: boolean;
  /**
 * Hash of P2's traps (these affect P1)
 */
p2_board_hash: Buffer;
  p2_position: u32;
  /**
 * Dice roll waiting for proof submission
 */
pending_roll: Option<u32>;
  player1: string;
  player1_points: i128;
  player2: string;
  player2_points: i128;
  /**
 * Total snakes on board (6, 8, or 10). Each player places half.
 */
snake_count: u32;
  status: GameStatus;
  winner: Option<string>;
}

export type GameStatus = {tag: "Setup", values: void} | {tag: "Active", values: void} | {tag: "Finished", values: void};

export interface Client {
  /**
   * Construct and simulate a upgrade transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  upgrade: ({new_wasm_hash}: {new_wasm_hash: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a get_game transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_game: ({session_id}: {session_id: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Result<GameState>>>

  /**
   * Construct and simulate a get_admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_admin: (options?: MethodOptions) => Promise<AssembledTransaction<string>>

  /**
   * Construct and simulate a roll_dice transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Roll the dice for the current player. Uses on-chain PRNG.
   * The opponent (dealer) must then submit a proof via `submit_outcome`.
   */
  roll_dice: ({session_id}: {session_id: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Result<u32>>>

  /**
   * Construct and simulate a set_admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_admin: ({new_admin}: {new_admin: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a create_game transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Create a new game between two players with staked points.
   * 
   * # Arguments
   * * `snake_count` — Total snakes on board: 6, 8, or 10. Each player places half.
   */
  create_game: ({session_id, player1, player2, player1_points, player2_points, snake_count}: {session_id: u32, player1: string, player2: string, player1_points: i128, player2_points: i128, snake_count: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a setup_board transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Each player commits their trap layout hash. Game becomes Active once both
   * boards are set.
   */
  setup_board: ({session_id, player, board_hash}: {session_id: u32, player: string, board_hash: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a submit_outcome transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * The opponent (dealer) submits a ZK proof verifying the move outcome.
   * 
   * # Arguments
   * * `session_id` — game ID
   * * `proof_bytes` — UltraHonk proof
   * * `public_inputs` — serialized public inputs matching circuit
   * * `claimed_dest` — where the mover ends up
   * * `is_snake_hit` — whether a snake was triggered
   * * `new_board_hash` — updated board hash (changes only on snake hit)
   */
  submit_outcome: ({session_id, proof_bytes, public_inputs, claimed_dest, is_snake_hit, new_board_hash}: {session_id: u32, proof_bytes: Buffer, public_inputs: Buffer, claimed_dest: u32, is_snake_hit: boolean, new_board_hash: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

}
export class Client extends ContractClient {
  static async deploy<T = Client>(
        /** Constructor/Initialization Args for the contract's `__constructor` method */
        {admin, verifier, game_hub}: {admin: string, verifier: string, game_hub: string},
    /** Options for initializing a Client as well as for calling a method, with extras specific to deploying. */
    options: MethodOptions &
      Omit<ContractClientOptions, "contractId"> & {
        /** The hash of the Wasm blob, which must already be installed on-chain. */
        wasmHash: Buffer | string;
        /** Salt used to generate the contract's ID. Passed through to {@link Operation.createCustomContract}. Default: random. */
        salt?: Buffer | Uint8Array;
        /** The format used to decode `wasmHash`, if it's provided as a string. */
        format?: "hex" | "base64";
      }
  ): Promise<AssembledTransaction<T>> {
    return ContractClient.deploy({admin, verifier, game_hub}, options)
  }
  constructor(public readonly options: ContractClientOptions) {
    super(
      new ContractSpec([ "AAAABAAAAAAAAAAAAAAABUVycm9yAAAAAAAADQAAAAAAAAAMR2FtZU5vdEZvdW5kAAAAAQAAAAAAAAAJTm90UGxheWVyAAAAAAAAAgAAAAAAAAALTm90WW91clR1cm4AAAAAAwAAAAAAAAANR2FtZU5vdEFjdGl2ZQAAAAAAAAQAAAAAAAAAEkdhbWVBbHJlYWR5U3RhcnRlZAAAAAAABQAAAAAAAAAPQm9hcmRBbHJlYWR5U2V0AAAAAAYAAAAAAAAADU5vUGVuZGluZ1JvbGwAAAAAAAAHAAAAAAAAABJSb2xsQWxyZWFkeVBlbmRpbmcAAAAAAAgAAAAAAAAAEkludmFsaWREZXN0aW5hdGlvbgAAAAAACQAAAAAAAAAXUHJvb2ZWZXJpZmljYXRpb25GYWlsZWQAAAAACgAAAAAAAAAOQm9hcmRzTm90UmVhZHkAAAAAAAsAAAAAAAAAEEdhbWVBbHJlYWR5RW5kZWQAAAAMAAAAAAAAABFJbnZhbGlkU25ha2VDb3VudAAAAAAAAA0=",
        "AAAAAgAAAAAAAAAAAAAAB0RhdGFLZXkAAAAABAAAAAEAAAAAAAAABEdhbWUAAAABAAAABAAAAAAAAAAAAAAABUFkbWluAAAAAAAAAAAAAAAAAAAOR2FtZUh1YkFkZHJlc3MAAAAAAAAAAAAAAAAAD1ZlcmlmaWVyQWRkcmVzcwA=",
        "AAAAAQAAAAAAAAAAAAAACUdhbWVTdGF0ZQAAAAAAAA0AAAAkSGFzaCBvZiBQMSdzIHRyYXBzICh0aGVzZSBhZmZlY3QgUDIpAAAADXAxX2JvYXJkX2hhc2gAAAAAAAPuAAAAIAAAAAAAAAALcDFfcG9zaXRpb24AAAAABAAAACN0cnVlID0gUDEncyB0dXJuLCBmYWxzZSA9IFAyJ3MgdHVybgAAAAAHcDFfdHVybgAAAAABAAAAJEhhc2ggb2YgUDIncyB0cmFwcyAodGhlc2UgYWZmZWN0IFAxKQAAAA1wMl9ib2FyZF9oYXNoAAAAAAAD7gAAACAAAAAAAAAAC3AyX3Bvc2l0aW9uAAAAAAQAAAAmRGljZSByb2xsIHdhaXRpbmcgZm9yIHByb29mIHN1Ym1pc3Npb24AAAAAAAxwZW5kaW5nX3JvbGwAAAPoAAAABAAAAAAAAAAHcGxheWVyMQAAAAATAAAAAAAAAA5wbGF5ZXIxX3BvaW50cwAAAAAACwAAAAAAAAAHcGxheWVyMgAAAAATAAAAAAAAAA5wbGF5ZXIyX3BvaW50cwAAAAAACwAAAD1Ub3RhbCBzbmFrZXMgb24gYm9hcmQgKDYsIDgsIG9yIDEwKS4gRWFjaCBwbGF5ZXIgcGxhY2VzIGhhbGYuAAAAAAAAC3NuYWtlX2NvdW50AAAAAAQAAAAAAAAABnN0YXR1cwAAAAAH0AAAAApHYW1lU3RhdHVzAAAAAAAAAAAABndpbm5lcgAAAAAD6AAAABM=",
        "AAAAAgAAAAAAAAAAAAAACkdhbWVTdGF0dXMAAAAAAAMAAAAAAAAAAAAAAAVTZXR1cAAAAAAAAAAAAAAAAAAABkFjdGl2ZQAAAAAAAAAAAAAAAAAIRmluaXNoZWQ=",
        "AAAAAAAAAAAAAAAHdXBncmFkZQAAAAABAAAAAAAAAA1uZXdfd2FzbV9oYXNoAAAAAAAD7gAAACAAAAAA",
        "AAAAAAAAAAAAAAAIZ2V0X2dhbWUAAAABAAAAAAAAAApzZXNzaW9uX2lkAAAAAAAEAAAAAQAAA+kAAAfQAAAACUdhbWVTdGF0ZQAAAAAAAAM=",
        "AAAAAAAAAAAAAAAJZ2V0X2FkbWluAAAAAAAAAAAAAAEAAAAT",
        "AAAAAAAAAH5Sb2xsIHRoZSBkaWNlIGZvciB0aGUgY3VycmVudCBwbGF5ZXIuIFVzZXMgb24tY2hhaW4gUFJORy4KVGhlIG9wcG9uZW50IChkZWFsZXIpIG11c3QgdGhlbiBzdWJtaXQgYSBwcm9vZiB2aWEgYHN1Ym1pdF9vdXRjb21lYC4AAAAAAAlyb2xsX2RpY2UAAAAAAAABAAAAAAAAAApzZXNzaW9uX2lkAAAAAAAEAAAAAQAAA+kAAAAEAAAAAw==",
        "AAAAAAAAAAAAAAAJc2V0X2FkbWluAAAAAAAAAQAAAAAAAAAJbmV3X2FkbWluAAAAAAAAEwAAAAA=",
        "AAAAAAAAAJdDcmVhdGUgYSBuZXcgZ2FtZSBiZXR3ZWVuIHR3byBwbGF5ZXJzIHdpdGggc3Rha2VkIHBvaW50cy4KCiMgQXJndW1lbnRzCiogYHNuYWtlX2NvdW50YCDigJQgVG90YWwgc25ha2VzIG9uIGJvYXJkOiA2LCA4LCBvciAxMC4gRWFjaCBwbGF5ZXIgcGxhY2VzIGhhbGYuAAAAAAtjcmVhdGVfZ2FtZQAAAAAGAAAAAAAAAApzZXNzaW9uX2lkAAAAAAAEAAAAAAAAAAdwbGF5ZXIxAAAAABMAAAAAAAAAB3BsYXllcjIAAAAAEwAAAAAAAAAOcGxheWVyMV9wb2ludHMAAAAAAAsAAAAAAAAADnBsYXllcjJfcG9pbnRzAAAAAAALAAAAAAAAAAtzbmFrZV9jb3VudAAAAAAEAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAFlFYWNoIHBsYXllciBjb21taXRzIHRoZWlyIHRyYXAgbGF5b3V0IGhhc2guIEdhbWUgYmVjb21lcyBBY3RpdmUgb25jZSBib3RoCmJvYXJkcyBhcmUgc2V0LgAAAAAAAAtzZXR1cF9ib2FyZAAAAAADAAAAAAAAAApzZXNzaW9uX2lkAAAAAAAEAAAAAAAAAAZwbGF5ZXIAAAAAABMAAAAAAAAACmJvYXJkX2hhc2gAAAAAA+4AAAAgAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAEJEZXBsb3kgd2l0aCBhZG1pbiwgdmVyaWZpZXIgY29udHJhY3QgYWRkcmVzcywgYW5kIEdhbWVIdWIgYWRkcmVzcy4AAAAAAA1fX2NvbnN0cnVjdG9yAAAAAAAAAwAAAAAAAAAFYWRtaW4AAAAAAAATAAAAAAAAAAh2ZXJpZmllcgAAABMAAAAAAAAACGdhbWVfaHViAAAAEwAAAAA=",
        "AAAAAAAAAXZUaGUgb3Bwb25lbnQgKGRlYWxlcikgc3VibWl0cyBhIFpLIHByb29mIHZlcmlmeWluZyB0aGUgbW92ZSBvdXRjb21lLgoKIyBBcmd1bWVudHMKKiBgc2Vzc2lvbl9pZGAg4oCUIGdhbWUgSUQKKiBgcHJvb2ZfYnl0ZXNgIOKAlCBVbHRyYUhvbmsgcHJvb2YKKiBgcHVibGljX2lucHV0c2Ag4oCUIHNlcmlhbGl6ZWQgcHVibGljIGlucHV0cyBtYXRjaGluZyBjaXJjdWl0CiogYGNsYWltZWRfZGVzdGAg4oCUIHdoZXJlIHRoZSBtb3ZlciBlbmRzIHVwCiogYGlzX3NuYWtlX2hpdGAg4oCUIHdoZXRoZXIgYSBzbmFrZSB3YXMgdHJpZ2dlcmVkCiogYG5ld19ib2FyZF9oYXNoYCDigJQgdXBkYXRlZCBib2FyZCBoYXNoIChjaGFuZ2VzIG9ubHkgb24gc25ha2UgaGl0KQAAAAAADnN1Ym1pdF9vdXRjb21lAAAAAAAGAAAAAAAAAApzZXNzaW9uX2lkAAAAAAAEAAAAAAAAAAtwcm9vZl9ieXRlcwAAAAAOAAAAAAAAAA1wdWJsaWNfaW5wdXRzAAAAAAAADgAAAAAAAAAMY2xhaW1lZF9kZXN0AAAABAAAAAAAAAAMaXNfc25ha2VfaGl0AAAAAQAAAAAAAAAObmV3X2JvYXJkX2hhc2gAAAAAA+4AAAAgAAAAAQAAA+kAAAACAAAAAw==" ]),
      options
    )
  }
  public readonly fromJSON = {
    upgrade: this.txFromJSON<null>,
        get_game: this.txFromJSON<Result<GameState>>,
        get_admin: this.txFromJSON<string>,
        roll_dice: this.txFromJSON<Result<u32>>,
        set_admin: this.txFromJSON<null>,
        create_game: this.txFromJSON<Result<void>>,
        setup_board: this.txFromJSON<Result<void>>,
        submit_outcome: this.txFromJSON<Result<void>>
  }
}