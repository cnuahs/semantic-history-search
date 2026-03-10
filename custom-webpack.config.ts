// see https://www.npmjs.com/package/@angular-builders/custom-webpack
import type { Configuration } from "webpack";
import webpack from "webpack";

// Note: AJV transforms/compiles a JSON Schema to an actual JS function. You can then call that function
//       to validate input against said schema. BUT, to generate the function AJV uses dynamic code
//       evaluation, which means doing this at runtime exposes us to the risk of code injection. To avoid
//       this (and the need to add 'unsafe-eval' to our CSP in manifest.json) we use webpack's compile hook
//       hook to "pre-compile" our validator function(s).
import { compile } from "./utils/ajv-utils";

export default {
  entry: {
    background: "src/background.ts",
    content: "src/content.ts",
  },
  module: {
    rules: [
      {
        test: /\.css$/,
        use: [
          {
            loader: 'postcss-loader',
            options: {
              postcssOptions: {
                plugins: [
                  require('@tailwindcss/postcss'),
                ],
              },
            },
          },
        ],
      },
    ],
  },
  plugins: [
    new webpack.NormalModuleReplacementPlugin(
      /^node:/,
      (resource) => {
        resource.request = resource.request.replace(/^node:/, '');
      }
    ),
    {
      apply: (compiler) => {
        compiler.hooks.compile.tap("AjvPlugin", (_params) => {
          compile({ schema: "src/schemas/settings.json", useDefaults: true });
        });
      },
    },
  ],
  optimization: {
    runtimeChunk: false,
  },
  node: {
    global: true, // Fix for "Uncaught ReferenceError: global is not defined" when importing Pinecone
  },
  experiments: {
    topLevelAwait: true, // Fix for "Module parse failed: The top-level-await experiment is not enabled" when instantiating PineconeStore
  },
  resolve: {
    fallback: {
      // The assistant and chat streaming features in @pinecone-database/pinecone v5+ use the built-in Node.js 'fs',
      // 'path' and 'stream' modules but these are not available in the browser environment. When webpack encounters
      // imports for these modules it tries to find browser-compatible polyfills for them, fails, and throws
      // "Module not found" errors. We're not using these features so just set these fallbacks to false, telling webpack to
      // ignore these imports and not attempt to polyfill them for the browser.
      fs: false,
      path: false,
      stream: false,
    },
  },
} as Configuration;
