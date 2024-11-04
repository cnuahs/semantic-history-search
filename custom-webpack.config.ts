// see https://www.npmjs.com/package/@angular-builders/custom-webpack
import type { Configuration } from 'webpack';

export default {
    entry: { 
        background: 'src/background.ts'
    },
    optimization: {
        runtimeChunk: false
    }
} as Configuration;
