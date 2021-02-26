/**
 * this class forces us to communicate with the engine with the same interface regardless if we are the server, on the main thread or across the worker thread
 * this will be the ONLY communication channel between the engine and the outside world
 * */

import { applyNetworkStateToClient } from './networking/functions/applyNetworkStateToClient';
import { WorldStateModel } from './networking/schema/worldStateSchema';
import { loadScene } from './scene/functions/SceneLoading';
export class EngineProxy {

  static instance: EngineProxy;
  
  constructor() {
    EngineProxy.instance = this;
  }

  loadScene(result) {
    loadScene(result);
  }

  transferNetworkBuffer(buffer, delta) {
    const unbufferedState = WorldStateModel.fromBuffer(buffer);
    if(!unbufferedState) console.warn("Couldn't deserialize buffer, probably still reading the wrong one")
    if(unbufferedState) applyNetworkStateToClient(unbufferedState, delta);
  }
}

export enum EngineMessageType {
  ENGINE_CALL = "ENGINE_CALL",

} 