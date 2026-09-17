declare module "epub-gen" {
  interface EpubChapter {
    title: string;
    data: string;
  }

  interface EpubOptions {
    title: string;
    author: string | string[];
    publisher?: string;
    cover?: string;
    lang?: string;
    tocTitle?: string;
    tempDir?: string;
    content: EpubChapter[];
    css?: string;
    verbose?: boolean;
  }

  class Epub {
    constructor(options: EpubOptions, outputPath: string);
    promise: Promise<void>;
  }

  export = Epub;
}
