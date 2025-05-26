declare module 'madge' {
    interface MadgeOptions {
        tsConfig?: string;
        includeNpm?: boolean;
        fileExtensions?: string[];
        excludeRegExp?: RegExp | RegExp[];
        requireConfig?: string;
        webpackConfig?: string;
        baseDir?: string;
        dependencyFilter?: (dep: string) => boolean;
    }

    interface MadgeInstance {
        circular(): string[][];
        depends(): { [key: string]: string[] };
        orphans(): string[];
        leaves(): string[];
        dot(): string;
        svg(): Promise<string>;
        image(imagePath: string): Promise<string>;
    }

    function madge(path: string, options?: MadgeOptions): Promise<MadgeInstance>;

    export = madge;
}