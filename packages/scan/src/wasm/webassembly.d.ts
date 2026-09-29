/**
 * The slice of the `WebAssembly` global this package calls, declared because
 * neither `@types/node` 22 nor the ES2022 lib declares it (it lives in
 * TypeScript's DOM lib). Pulling in the whole DOM lib would type `document` and
 * `window` in a Node CLI; this names only what `loader.ts` uses, and the public
 * signatures of `loader.ts` do not mention it, so a consumer of `dist/` needs
 * nothing extra.
 */
declare namespace WebAssembly {
  type ImportValue = (...args: number[]) => number;
  type Imports = Record<string, Record<string, ImportValue>>;
  interface ModuleImportDescriptor {
    module: string;
    name: string;
    kind: string;
  }
  class Module {
    static imports(module: Module): ModuleImportDescriptor[];
  }
  class Memory {
    readonly buffer: ArrayBuffer;
  }
  class Instance {
    readonly exports: Record<string, unknown>;
  }
  function compile(bytes: Uint8Array): Promise<Module>;
  function instantiate(module: Module, imports: Imports): Promise<Instance>;
}
