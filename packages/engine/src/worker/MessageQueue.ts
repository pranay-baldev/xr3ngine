import {
  Audio as THREE_Audio,
  AudioListener as THREE_AudioListener,
  AudioLoader as THREE_AudioLoader,
  Event as DispatchEvent,
  Matrix4,
  Object3D,
  PositionalAudio as THREE_PositionalAudio,
  Scene,
} from 'three';
import { MathUtils } from 'three';
const { generateUUID } = MathUtils;

interface Message {
  messageType: MessageType | string;
  message: object;
  transferables?: Transferable[];
}

enum MessageType {
  OFFSCREEN_CANVAS,
  ANIMATE,
  ADD_EVENT,
  REMOVE_EVENT,
  EVENT,
  DOCUMENT_ELEMENT_CREATE,
  DOCUMENT_ELEMENT_FUNCTION_CALL,
  DOCUMENT_ELEMENT_PARAM_SET,
  DOCUMENT_ELEMENT_ADD_EVENT,
  DOCUMENT_ELEMENT_REMOVE_EVENT,
  DOCUMENT_ELEMENT_EVENT,
  DOCUMENT_ELEMENT_PROP_UPDATE,
  VIDEO_ELEMENT_CREATE,
  VIDEO_ELEMENT_FRAME,
  OBJECT3D_CREATE,
  OBJECT3D_DESTROY,
  OBJECT3D_MATRIX,
  OBJECT3D_PARAM_SET,
  OBJECT3D_FUNCTION_CALL,
  AUDIO_BUFFER_LOAD,
  AUDIO_BUFFER_SET,
  AUDIO_SOURCE_STREAM_SET,
  AUDIO_SOURCE_ELEMENT_SET,
}

function simplifyObject(object: any): any {
  let messageData = {};
  for (let prop in object)
    if (typeof object[prop] !== 'function' && typeof object[prop] !== 'object')
      messageData[prop] = object[prop];
  return messageData;
}

class ExtendableProxy {
  constructor(
    getset = {
      get(target: any, name: any, receiver: any) {
        if (!Reflect.has(target, name)) {
          return undefined;
        }
        return Reflect.get(target, name, receiver);
      },
      set(target: any, name: any, value: any, receiver: any) {
        return Reflect.set(target, name, value, receiver);
      },
    },
  ) {
    return new Proxy(this, getset);
  }
}

class EventDispatcherProxy extends ExtendableProxy {
  [x: string]: any;
  eventTarget: EventTarget;
  messageTypeFunctions: Map<MessageType, any>;
  _listeners: any;

  constructor({
    eventTarget,
    eventListener,
    getset,
  }: {
    eventTarget: EventTarget;
    eventListener: any;
    getset?: any;
  }) {
    super(getset);
    this._listeners = {};
    this.eventTarget = eventTarget;
    this.messageTypeFunctions = new Map<MessageType, any>();

    this.messageTypeFunctions.set(MessageType.EVENT, (event: any) => {
      event.preventDefault = () => {};
      event.stopPropagation = () => {};
      this.dispatchEvent(event as any);
    });
    this.messageTypeFunctions.set(
      MessageType.ADD_EVENT,
      ({ type }: { type: string }) => {
        this.eventTarget.addEventListener(type, eventListener);
      },
    );
    this.messageTypeFunctions.set(
      MessageType.REMOVE_EVENT,
      ({ type }: { type: string }) => {
        this.eventTarget.removeEventListener(type, eventListener);
      },
    );
  }

  addEventListener(type: string, listener: any) {
    if (this._listeners[type] === undefined) {
      this._listeners[type] = [];
    }
    if (this._listeners[type].indexOf(listener) === -1) {
      this._listeners[type].push(listener);
    }
  }

  hasEventListener(type: string, listener: any) {
    return (
      this._listeners[type] !== undefined &&
      this._listeners[type].indexOf(listener) !== -1
    );
  }

  removeEventListener(type: string, listener: any) {
    var listenerArray = this._listeners[type];
    if (listenerArray !== undefined) {
      var index = listenerArray.indexOf(listener);
      if (index !== -1) {
        listenerArray.splice(index, 1);
      }
    }
  }

  dispatchEvent(event: any) {
    var listenerArray = this._listeners[event.type];
    if (listenerArray !== undefined) {
      event.target = this;
      var array = listenerArray.slice(0);
      for (var i = 0, l = array.length; i < l; i++) {
        array[i].call(this, event);
      }
    }
  }
}

class MessageQueue extends EventDispatcherProxy {
  messagePort: any;
  queue: Message[];
  interval: NodeJS.Timeout;
  remoteDocumentObjects: Map<string, DocumentElementProxy>;
  eventTarget: EventTarget;
  object3dProxies: Object3DProxy[] = [];

  constructor({
    messagePort,
    eventTarget,
  }: {
    messagePort: any;
    eventTarget: EventTarget;
  }) {
    super({
      eventTarget,
      eventListener: (args: any) => {
        this.queue.push({
          messageType: MessageType.EVENT,
          message: simplifyObject(args),
        } as Message);
      },
    });
    this.messagePort = messagePort;
    this.eventTarget = eventTarget;
    this.queue = [];
    this.remoteDocumentObjects = new Map<string, DocumentElementProxy>();

    this.messagePort.onmessage = (message: any) => {
      this.receiveQueue(message.data as object[]);
    };
    this.interval = setInterval(() => {
      this.sendQueue();
    }, 1000 / 60);
  }
  sendEvent(eventType: string, eventDetail: any, transferables?: Transferable[]) {
    this.queue.push({
      messageType: MessageType.EVENT,
      message: {
        type: eventType,
        detail: eventDetail
      },
      transferables
    } as Message);
  }
  sendQueue() {
    if (!this.queue?.length) return;
    const messages: object[] = [];
    this.queue.forEach((message: Message) => {
      messages.push({
        type: message.messageType,
        message: message.message,
      });
    });
    const transferables: Transferable[] = [];
    this.queue.forEach((message: Message) => {
      message.transferables && transferables.push(...message.transferables);
    });
    try {
      this.messagePort.postMessage(messages, transferables);
    } catch (e) {
      console.log(e);
    }
    this.queue = [];
  }

  receiveQueue(queue: object[]) {
    queue.forEach((element: object) => {
      /** @ts-ignore */
      const { type, message } = element;
      if (!message.returnID || message.returnID === '') {
        if (this.messageTypeFunctions.has(type)) {
          this.messageTypeFunctions.get(type)(message);
        }
      } else {
        if (this.remoteDocumentObjects.get(message.returnID)) {
          this.remoteDocumentObjects
            .get(message.returnID)
            ?.messageTypeFunctions.get(type)(message);
        }
      }
    });
  }

  addEventListener(
    type: string,
    listener: (event: DispatchEvent) => void,
  ): void {
    this.queue.push({
      messageType: MessageType.ADD_EVENT,
      message: { type },
    } as Message);
    super.addEventListener(type, listener);
  }

  removeEventListener(
    type: string,
    listener: (event: DispatchEvent) => void,
  ): void {
    this.queue.push({
      messageType: MessageType.REMOVE_EVENT,
      message: { type },
    } as Message);
    super.removeEventListener(type, listener);
  }
}

class DocumentElementProxy extends EventDispatcherProxy {
  messageQueue: MessageQueue;
  uuid: string;
  type: string;
  eventTarget: EventTarget;
  transferedProps: string[] = [];
  remoteCalls: string[];

  constructor({
    messageQueue,
    type,
    remoteCalls,
    eventTarget,
  }: {
    messageQueue: MessageQueue;
    type: string;
    remoteCalls?: string[];
    eventTarget?: EventTarget;
  }) {
    super({
      eventTarget: eventTarget || messageQueue.eventTarget,
      eventListener: (args: any) => {
        this.messageQueue.queue.push({
          messageType: MessageType.EVENT,
          message: simplifyObject(args),
        } as Message);
      },
      getset: {
        get(target: any, name: any, receiver: any) {
          if (!Reflect.has(target, name)) {
            return undefined;
          }
          return Reflect.get(target, name, receiver);
        },
        set(target: any, name: any, value: any, receiver: any) {
          const props = Reflect.get(target, 'transferedProps') as string[];
          if (props?.includes(name)) {
            Reflect.get(target, 'messageQueue').queue.push({
              messageType: MessageType.DOCUMENT_ELEMENT_PARAM_SET,
              message: {
                param: name,
                uuid: Reflect.get(target, 'uuid'),
                arg: value,
              },
            } as Message);
          }
          return Reflect.set(target, name, value, receiver);
        },
      },
    });
    this.remoteCalls = remoteCalls || [];
    for (let call of this.remoteCalls) {
      this[call] = (...args: any) => {
        this.messageQueue.queue.push({
          messageType: MessageType.DOCUMENT_ELEMENT_FUNCTION_CALL,
          message: {
            call,
            uuid: this.uuid,
            args,
          },
        } as Message);
        return true;
      };
    }
    this.type = type;
    this.messageQueue = messageQueue;
    this.eventTarget = eventTarget || messageQueue.eventTarget;
    this.uuid = generateUUID();
    this.messageQueue.remoteDocumentObjects.set(this.uuid, this);
    this.messageQueue.queue.push({
      messageType: MessageType.DOCUMENT_ELEMENT_CREATE,
      message: {
        type,
        uuid: this.uuid,
      },
    } as Message);
  }

  addEventListener(
    type: string,
    listener: (event: DispatchEvent) => void,
  ): void {
    this.messageQueue.queue.push({
      messageType: MessageType.DOCUMENT_ELEMENT_ADD_EVENT,
      message: { type, uuid: this.uuid },
    } as Message);
    super.addEventListener(type, listener);
  }

  removeEventListener(
    type: string,
    listener: (event: DispatchEvent) => void,
  ): void {
    this.messageQueue.queue.push({
      messageType: MessageType.DOCUMENT_ELEMENT_REMOVE_EVENT,
      message: { type, uuid: this.uuid },
    } as Message);
    super.removeEventListener(type, listener);
  }
}

const audioRemoteFunctionCalls: string[] = ['play'];
const audioRemoteProps: string[] = ['src'];

class AudioDocumentElementProxy extends DocumentElementProxy {
  constructor({
    messageQueue,
    type = 'audio',
    remoteCalls = [],
  }: {
    messageQueue: MessageQueue;
    type?: string;
    remoteCalls?: string[];
  }) {
    super({
      messageQueue,
      type,
      remoteCalls: [...remoteCalls, ...audioRemoteFunctionCalls],
    });
    this.transferedProps.push(...audioRemoteProps);
  }
}

const videoRemoteFunctionCalls: string[] = [];
const videoRemoteProps: string[] = [];

export class VideoDocumentElementProxy extends AudioDocumentElementProxy {
  frameCallback: any;
  width: number;
  height: number;
  video: ImageData | null;
  readyState: number;

  constructor({ messageQueue }: { messageQueue: MessageQueue }) {
    super({
      messageQueue,
      type: 'video',
      remoteCalls: [],
    });
    this.video = null;
    this.width = 0;
    this.height = 0;
    this.readyState = 0;
    this.messageTypeFunctions.set(
      MessageType.VIDEO_ELEMENT_CREATE,
      ({ width, height }: { width: number; height: number }) => {
        this.width = width;
        this.height = height;
        this.video = new ImageData(
          new Uint8ClampedArray(4 * this.width * this.height).fill(0),
          this.width,
          this.height,
        );
      },
    );
    this.messageTypeFunctions.set(
      MessageType.VIDEO_ELEMENT_FRAME,
      ({
        imageBuffer,
        readyState,
      }: {
        imageBuffer: ArrayBuffer;
        readyState: number;
      }) => {
        this.video = new ImageData(
          new Uint8ClampedArray(imageBuffer),
          this.width,
          this.height,
        );
        this.readyState = readyState;
        if (this.frameCallback) {
          this.frameCallback();
        }
      },
    );

    this.transferedProps.push(...videoRemoteProps);
  }
  requestVideoFrameCallback(callback: any) {
    this.frameCallback = callback;
  }
}
class Object3DProxy extends Object3D {
  [x: string]: any;
  proxyID: string;
  setQueue: Map<string, any> = new Map<string, any>();
  messageQueue: MainProxy;

  constructor(args: any = {}) {
    super();
    this.type = args.type || 'Object3D';
    this.proxyID = generateUUID();
    this.messageQueue = (globalThis as any).__messageQueue as MainProxy;
    this.messageQueue.object3dProxies.push(this);
    this.messageQueue.queue.push({
      messageType: MessageType.OBJECT3D_CREATE,
      message: {
        proxyID: this.proxyID,
        type: this.type,
      },
    } as Message);

    this.addEventListener('removed', () => {
      this.messageQueue.object3dProxies.splice(
        this.messageQueue.object3dProxies.indexOf(this),
        1,
      );
      this.messageQueue.queue.push({
        messageType: MessageType.OBJECT3D_DESTROY,
        message: {
          proxyID: this.proxyID,
        },
      } as Message);
    });
  }
  __callFunc(call: string, ...args: any) {
    this.messageQueue.queue.push({
      messageType: MessageType.OBJECT3D_FUNCTION_CALL,
      message: {
        call,
        proxyID: this.proxyID,
        args,
      },
    } as Message);
  }
}

export class AudioListenerProxy extends Object3DProxy {
  constructor() {
    super({ type: 'AudioListener' });
  }
}

export type AudioBufferProxyID = string;

export class AudioLoaderProxy {
  constructor() {}
  load(url: string, callback: any) {
    const requestCallback = (event: DispatchEvent) => {
      callback(event.type as AudioBufferProxyID);
      ((globalThis as any).__messageQueue as MessageQueue).removeEventListener(
        url,
        requestCallback,
      );
    };
    ((globalThis as any).__messageQueue as MessageQueue).addEventListener(
      url,
      requestCallback,
    );
    ((globalThis as any).__messageQueue as MessageQueue).queue.push({
      messageType: MessageType.AUDIO_BUFFER_LOAD,
      message: {
        url,
      },
    } as Message);
  }
}

export class AudioObjectProxy extends Object3DProxy {
  constructor(args: any = {}) {
    super({ type: args.type || 'Audio' });
  }
  // HTMLMediaElement - <audio> & <video>
  setMediaElementSource(source: AudioDocumentElementProxy) {
    ((globalThis as any).__messageQueue as MessageQueue).queue.push({
      messageType: MessageType.AUDIO_SOURCE_ELEMENT_SET,
      message: {
        sourceID: source.uuid,
        proxyID: this.proxyID,
      },
    } as Message);
  }
  // HTMLMediaStream - Webcams
  // this might need to be implemented at application level
  // setMediaStreamSource(source: AudioDocumentElementProxy) {
  //   ((globalThis as any).__messageQueue as MessageQueue).queue.push({
  //     messageType: MessageType.AUDIO_SOURCE_STREAM_SET,
  //     message: {
  //       sourceID: source.uuid,
  //       proxyID: this.proxyID,
  //     },
  //   } as Message);
  // }
  // AudioBuffer - AudioLoader.load
  setBuffer(buffer: AudioBufferProxyID) {
    ((globalThis as any).__messageQueue as MessageQueue).queue.push({
      messageType: MessageType.AUDIO_BUFFER_SET,
      message: {
        buffer,
        proxyID: this.proxyID,
      },
    } as Message);
  }
  setLoop(loop: boolean) {
    this.__callFunc('setLoop', loop);
  }
  setVolume(volume: number) {
    this.__callFunc('setVolume', volume);
  }
  play() {
    this.__callFunc('play');
  }
}

export class PositionalAudioObjectProxy extends AudioObjectProxy {
  constructor() {
    super({ type: 'PositionalAudio' });
  }
}
export class WorkerProxy extends MessageQueue {
  constructor({
    messagePort,
    eventTarget,
  }: {
    messagePort: any;
    eventTarget: EventTarget;
  }) {
    super({ messagePort, eventTarget });
  }
}

export class MainProxy extends MessageQueue {
  canvas: OffscreenCanvas | null;
  width: number;
  height: number;
  left: number;
  top: number;

  constructor({
    messagePort,
    eventTarget = new EventTarget(),
  }: {
    messagePort: any;
    eventTarget?: EventTarget;
  }) {
    super({ messagePort, eventTarget });

    this.canvas = null;
    this.width = 0;
    this.height = 0;
    this.left = 0;
    this.top = 0;

    this.focus = this.focus.bind(this);
    this.getBoundingClientRect = this.getBoundingClientRect.bind(this);
  }

  focus() {}
  get ownerDocument() {
    return this;
  }
  get clientWidth() {
    return this.width;
  }
  get clientHeight() {
    return this.height;
  }
  get innerWidth() {
    return this.width;
  }
  get innerHeight() {
    return this.height;
  }
  getBoundingClientRect() {
    return {
      left: this.left,
      top: this.top,
      width: this.width,
      height: this.height,
      right: this.left + this.width,
      bottom: this.top + this.height,
    };
  }
  sendQueue() {
    for (const obj of this.object3dProxies) {
      this.queue.push({
        messageType: MessageType.OBJECT3D_MATRIX,
        message: {
          matrixWorld: obj.matrixWorld,
          proxyID: obj.proxyID,
        },
      } as Message);
    }
    super.sendQueue();
  }
}

export async function createWorker(
  workerURL: string | URL,
  canvas: HTMLCanvasElement,
  options: any
) {
  const worker = new Worker(workerURL);//, { type: 'module' });
  const messageQueue = new WorkerProxy({
    messagePort: worker,
    eventTarget: canvas,
  });
  const { width, height, top, left } = canvas.getBoundingClientRect();
  const offscreen = canvas.transferControlToOffscreen();
  const documentElementMap = new Map<string, any>();
  messageQueue.messageTypeFunctions.set(
    MessageType.DOCUMENT_ELEMENT_FUNCTION_CALL,
    ({ call, uuid, args }: { call: string; uuid: string; args: any[] }) => {
      documentElementMap.get(uuid)[call](...args);
    },
  );
  messageQueue.messageTypeFunctions.set(
    MessageType.DOCUMENT_ELEMENT_PARAM_SET,
    ({ param, uuid, arg }: { param: string; uuid: string; arg: any }) => {
      documentElementMap.get(uuid)[param] = arg;
    },
  );
  messageQueue.messageTypeFunctions.set(
    MessageType.DOCUMENT_ELEMENT_ADD_EVENT,
    ({ type, uuid }: { type: string; uuid: string }) => {
      if (documentElementMap.get(uuid)) {
        const listener = (...args: any) => {
          const event = simplifyObject(args) as any;
          event.type = type;
          event.returnID = uuid;
          messageQueue.queue.push({
            messageType: MessageType.EVENT,
            message: event,
          } as Message);
        };
        documentElementMap.get(uuid).addEventListener(type, listener);
        documentElementMap.get(uuid).proxyListener = listener;
      }
    },
  );
  messageQueue.messageTypeFunctions.set(
    MessageType.DOCUMENT_ELEMENT_REMOVE_EVENT,
    ({ type, uuid }: { type: string; uuid: string }) => {
      if (documentElementMap.get(uuid)) {
        documentElementMap
          .get(uuid)
          .removeEventListener(
            type,
            documentElementMap.get(uuid).proxyListener,
          );
        delete documentElementMap.get(uuid).proxyListener;
      }
    },
  );
  messageQueue.messageTypeFunctions.set(
    MessageType.DOCUMENT_ELEMENT_CREATE,
    ({ type, uuid }: { type: string; uuid: string }) => {
      switch (type) {
        case 'audio':
          const audio = document.createElement('audio') as HTMLVideoElement;
          documentElementMap.set(uuid, audio);
          break;
        case 'video':
          const video = document.createElement('video') as HTMLVideoElement;
          documentElementMap.set(uuid, video);
          video.onplay = (ev: any) => {
            const drawCanvas = document.createElement(
              'canvas',
            ) as HTMLCanvasElement;
            drawCanvas.width = video.videoWidth;
            drawCanvas.height = video.videoHeight;
            const context = drawCanvas.getContext('2d');
            messageQueue.queue.push({
              messageType: MessageType.VIDEO_ELEMENT_CREATE,
              message: {
                width: video.videoWidth,
                height: video.videoHeight,
                returnID: uuid,
              },
            } as Message);

            const sendFrame = async () => {
              context?.drawImage(video, 0, 0);
              const imageBuffer = context?.getImageData(
                0,
                0,
                video.videoWidth,
                video.videoHeight,
              ).data.buffer;
              if (imageBuffer) {
                messageQueue.queue.push({
                  messageType: MessageType.VIDEO_ELEMENT_FRAME,
                  message: {
                    imageBuffer,
                    readyState: video.readyState,
                    returnID: uuid,
                  },
                  transferables: [imageBuffer],
                } as Message);
              }
              /** @ts-ignore */
              video.requestVideoFrameCallback(sendFrame);
            };
            /** @ts-ignore */
            video.requestVideoFrameCallback(sendFrame);
          };
          break;
        default:
          break;
      }
    },
  );
  const sceneObjects: Map<string, Object3D> = new Map<string, Object3D>();
  const audioScene = new Scene();
  const audioLoader = new THREE_AudioLoader();
  const audioBuffers: Map<string, AudioBuffer> = new Map<string, AudioBuffer>();
  let audioListener: any = undefined;

  messageQueue.messageTypeFunctions.set(
    MessageType.AUDIO_BUFFER_LOAD,
    ({ url }: { url: string }) => {
      audioLoader.load(url, (buffer: AudioBuffer) => {
        audioBuffers.set(url, buffer);
        messageQueue.queue.push({
          messageType: MessageType.EVENT,
          message: {
            type: url,
          },
        } as Message);
      });
    },
  );
  messageQueue.messageTypeFunctions.set(
    MessageType.AUDIO_BUFFER_SET,
    ({ buffer, proxyID }: { buffer: string; proxyID: string }) => {
      const audioBuffer = audioBuffers.get(buffer) as AudioBuffer;
      const obj = sceneObjects.get(proxyID) as THREE_Audio;
      if (audioBuffer && obj) {
        obj.setBuffer(audioBuffer);
      }
    },
  );
  messageQueue.messageTypeFunctions.set(
    MessageType.AUDIO_SOURCE_ELEMENT_SET,
    ({ sourceID, proxyID }: { sourceID: string; proxyID: string }) => {
      const source = documentElementMap.get(sourceID) as HTMLMediaElement;
      const obj = sceneObjects.get(proxyID) as THREE_Audio;
      if (source && obj) {
        obj.setMediaElementSource(source);
      }
    },
  );
  messageQueue.messageTypeFunctions.set(
    MessageType.OBJECT3D_CREATE,
    ({
      type,
      proxyID,
      args,
    }: {
      type: string;
      proxyID: string;
      args: any[];
    }) => {
      let obj;
      switch (type) {
        case 'Audio':
          obj = new THREE_Audio(audioListener);
          break;
        case 'PositionalAudio':
          obj = new THREE_PositionalAudio(audioListener);
          break;
        case 'AudioListener':
          obj = new THREE_AudioListener();
          audioListener = obj;
          break;
        default:
          break;
      }

      if (obj) {
        audioScene.add(obj);
        sceneObjects.set(proxyID, obj);
      }
    },
  );
  messageQueue.messageTypeFunctions.set(
    MessageType.OBJECT3D_PARAM_SET,
    ({ param, proxyID, arg }: { param: string; proxyID: string; arg: any }) => {
      const obj = sceneObjects.get(proxyID) as any;
      if (obj) {
        obj[param] = arg;
      }
    },
  );
  messageQueue.messageTypeFunctions.set(
    MessageType.OBJECT3D_FUNCTION_CALL,
    ({
      call,
      proxyID,
      args,
    }: {
      call: string;
      proxyID: string;
      args: any[];
    }) => {
      const obj = sceneObjects.get(proxyID) as any;
      if (obj) {
        obj[call](...args);
      }
    },
  );
  messageQueue.messageTypeFunctions.set(
    MessageType.OBJECT3D_MATRIX,
    ({ matrixWorld, proxyID }: { matrixWorld: Matrix4; proxyID: string }) => {
      const obj = sceneObjects.get(proxyID);
      if (obj) {
        obj.matrixWorld = matrixWorld;
        obj.matrixWorldNeedsUpdate = true;
      }
    },
  );
  messageQueue.messageTypeFunctions.set(
    MessageType.OBJECT3D_DESTROY,
    ({ proxyID }: { proxyID: string }) => {
      const obj = sceneObjects.get(proxyID);
      if (obj?.parent) {
        obj.parent.remove(obj);
      }
    },
  );
  messageQueue.queue.push({
    messageType: MessageType.OFFSCREEN_CANVAS,
    message: {
      width,
      height,
      top,
      left,
      canvas: offscreen,
      pixelRatio: window.devicePixelRatio,
      options
    },
    transferables: [offscreen],
  } as Message);
  window.addEventListener('resize', () => {
    messageQueue.queue.push({
      messageType: MessageType.EVENT,
      message: {
        type: 'resize',
        width: canvas.clientWidth,
        height: canvas.clientHeight,
      },
    } as Message);
  });
  return messageQueue;
}

export async function receiveWorker(onCanvas: any) {
  const messageQueue = new MainProxy({ messagePort: globalThis as any });
  messageQueue.messageTypeFunctions.set(
    MessageType.OFFSCREEN_CANVAS,
    (args: any) => {
      const {
        canvas,
        height,
        width,
        options
      }: {
        canvas: OffscreenCanvas;
        width: number;
        height: number;
        options
      } = args;
      messageQueue.canvas = canvas;
      messageQueue.width = width;
      messageQueue.height = height;
      canvas.addEventListener = (
        type: string,
        listener: (event: DispatchEvent) => void,
      ) => {
        messageQueue.addEventListener(type, listener);
      };
      canvas.removeEventListener = (
        type: string,
        listener: (event: DispatchEvent) => void,
      ) => {
        messageQueue.removeEventListener(type, listener);
      };
      /** @ts-ignore */
      canvas.ownerDocument = messageQueue;
      (globalThis as any).window = messageQueue;
      (globalThis as any).document = {
        addEventListener: (
          type: string,
          listener: (event: DispatchEvent) => void,
        ) => {
          messageQueue.addEventListener(type, listener);
        },
        removeEventListener: (
          type: string,
          listener: (event: DispatchEvent) => void,
        ) => {
          messageQueue.removeEventListener(type, listener);
        },
        ownerDocument: messageQueue,
        createElement(type: string): DocumentElementProxy | null {
          switch (type) {
            case 'audio':
              return new AudioDocumentElementProxy({ messageQueue });
            case 'video':
              return new VideoDocumentElementProxy({ messageQueue });
            default:
              return null;
          }
        },
      };

      onCanvas(args, messageQueue);
    },
  );
  messageQueue.addEventListener('resize', ({ width, height }: any) => {
    messageQueue.width = width;
    messageQueue.height = height;
  });
  (globalThis as any).__messageQueue = messageQueue;
  return messageQueue;
}
