// see https://www.npmjs.com/package/@angular-builders/custom-webpack
import type { Configuration } from 'webpack';

// Note: AJV transforms/compiles a JSON Schema to an actual JS function. You can then call that function
//       to validate input against said schema. BUT, to generate the function AJV uses dynamic code
//       evaluation, which means doing this at runtime exposes us to the risk of code injection. To avoid
//       this (and the need to add 'unsafe-eval' to our CSP in manifest.json) we use webpack's compile hook
//       hook to "pre-compile" our validator function(s).
import { compile } from './utils/ajv-utils';

export default {
    entry: { 
        background: 'src/background.ts',
        content: 'src/content.ts'
    },
    plugins: [
        {
            apply: (compiler) => {
                compiler.hooks.compile.tap("AjvPlugin", (_params) => {
                    compile( { schema: "src/schemas/settings.json", useDefaults: true } );
                });
            },
        },
    ],
    optimization: {
        runtimeChunk: false
    },
    node: {
        global: true // Fix for "Uncaught ReferenceError: global is not defined" when importing Pinecone
    },
    experiments: {
        topLevelAwait: true // Fix for "Module parse failed: The top-level-await experiment is not enabled" when instantiating PineconeStore
    }
} as Configuration;
