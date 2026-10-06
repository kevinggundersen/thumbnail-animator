// Ambient declarations for `npm run typecheck` (JSDoc + checkJs, not a TypeScript
// migration). The renderer is classic scripts sharing one global scope and reaches
// into DOM elements through getElementById/closest without narrowing, so the
// common expando and form-control properties are widened here. Precision can be
// added per file later with JSDoc casts.
interface Window {
    electronAPI: any;
    appSettings: any;
    selection: any;
    webgpuHamming: any;
    currentLightboxFilePath: string | null;
    currentLightboxFileUrl: string | null;
    unwrapIpc: (p: Promise<any>) => Promise<any>;
    __playbackBudget: any;
    __refreshClipGpuStatus: any;
    __lt: number[];
    [key: `_${string}`]: any;
}
interface EventTarget {
    closest?(selector: string): Element | null;
    tagName?: string;
    value?: any;
    checked?: boolean;
    classList?: DOMTokenList;
    dataset?: DOMStringMap;
    isContentEditable?: boolean;
}
interface Element {
    style?: CSSStyleDeclaration;
    dataset?: DOMStringMap;
    value?: any;
    checked?: boolean;
    type?: string;
    focus?(): void;
    click?(): void;
    select?(): void;
    paused?: boolean;
    offsetParent?: Element | null;
}
interface HTMLElement {
    value?: any;
    checked?: boolean;
    disabled?: boolean;
    src?: string;
    width?: number;
    height?: number;
    naturalWidth?: number;
    naturalHeight?: number;
    videoWidth?: number;
    videoHeight?: number;
    placeholder?: string;
    paused?: boolean;
    play?(): Promise<void>;
    pause?(): void;
    load?(): void;
    getContext?(id: string, opts?: any): any;
    select?(): void;
    // expando state the renderer keeps on cards and media elements
    _mediaEl?: any;
    _vsItemIndex?: number;
    _destroyed?: boolean;
    _blobUrl?: string | null;
    _gifOverlayPending?: Promise<any> | null;
    _gifScrubController?: any;
    _gifScrubCanvas?: any;
    _scrubRect?: any;
    _safetyTimer?: any;
    _previewId?: any;
    _dismissTimer?: any;
    _onclickAi?: any;
    _duration?: number;
    [key: `_${string}`]: any;
}
declare class ImageDecoder {
    constructor(init: { data: ArrayBuffer | ArrayBufferView, type: string });
    tracks: { ready: Promise<void>, selectedTrack: { frameCount: number } | null };
    completed: Promise<void>;
    decode(opts: { frameIndex?: number, completeFramesOnly?: boolean }): Promise<{ image: any, complete: boolean }>;
    close(): void;
    static isTypeSupported(type: string): Promise<boolean>;
}
declare var gifuctJs: any;
declare var WebPXMux: any;
declare var Fuse: any;
