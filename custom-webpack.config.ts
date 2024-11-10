// see https://www.npmjs.com/package/@angular-builders/custom-webpack
import type { Configuration } from 'webpack';

export default {
    entry: { 
        background: 'src/background.ts',
        content: 'src/content.ts'
    },
    optimization: {
        runtimeChunk: false
    },
    node: {
        global: true // Fix for "Uncaught ReferenceError: global is not defined" when importing Pinecone
    },
    // experiments: {
    //     topLevelAwait: true // Fix for "Module parse failed: The top-level-await experiment is not enabled" when instantiating PineconeStore
    // }
} as Configuration;
