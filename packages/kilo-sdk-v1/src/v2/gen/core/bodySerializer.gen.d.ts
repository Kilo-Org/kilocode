import type { ArrayStyle, ObjectStyle, SerializerOptions } from "./pathSerializer.gen.js";
export type QuerySerializer = (query: Record<string, unknown>) => string;
export type BodySerializer = (body: unknown) => unknown;
type QuerySerializerOptionsObject = {
    allowReserved?: boolean;
    array?: Partial<SerializerOptions<ArrayStyle>>;
    object?: Partial<SerializerOptions<ObjectStyle>>;
};
export type QuerySerializerOptions = QuerySerializerOptionsObject & {
    /**
     * Per-parameter serialization overrides. When provided, these settings
     * override the global array/object settings for specific parameter names.
     */
    parameters?: Record<string, QuerySerializerOptionsObject>;
};
export declare const formDataBodySerializer: {
    bodySerializer: (body: unknown) => FormData;
};
export declare const jsonBodySerializer: {
    bodySerializer: (body: unknown) => string;
};
export declare const urlSearchParamsBodySerializer: {
    bodySerializer: (body: unknown) => string;
};
export {};
