// AJV utils...

// 2024-11-25 - Shaun L. Cloherty <s.cloherty@ieee.org>

import {
  Ajv2020 as Ajv,
  type ValidateFunction as AjvValidateFunction,
} from "ajv/dist/2020";
import standaloneCode from "ajv/dist/standalone";

import { default as ajvFormats } from "ajv-formats";

import { type JSONSchema } from "json-schema-typed";

import ts from "typescript";

import * as fs from "fs";
import * as path from "path";

interface CompileOptions {
  schema: string; // filename
  target?: string; // filename (default: "${schema}.validator.js")

  strict?: boolean;

  allErrors?: boolean;
  useDefaults?: boolean;
}

export function compile(args: CompileOptions): void {
  const ajv = new Ajv({
    code: {
      source: true,
      esm: true,
      lines: true,
    },

    // default options
    strict: args.strict ? args.strict : true,
    allErrors: args.allErrors ? args.allErrors : true,
    useDefaults: args.useDefaults ? args.useDefaults : true,
  });
  ajvFormats(ajv);

  const schema = JSON.parse(fs.readFileSync(args.schema, "utf8")) as JSONSchema;

  const validate: AjvValidateFunction = ajv.compile(schema);
  const jscode = standaloneCode(ajv, validate);

  // write the module code to file...
  const target = args.target
    ? args.target
    : path.format({
        ...path.parse(args.schema),
        base: "",
        ext: ".validator.js",
      });
  fs.writeFileSync(target, jscode);

  // generate type declarations... (see https://stackoverflow.com/questions/70325695)
  const options: ts.CompilerOptions = {
    allowJs: true,
    declaration: true,
    emitDeclarationOnly: true,
  };

  let dts: string = ""; // will catch the declaration (.d.ts) file contents
  const host = ts.createCompilerHost(options);
  host.writeFile = (_name, contents) => (dts = contents);
  host.readFile = () => jscode;

  const program = ts.createProgram([target], options, host);
  program.emit();

  // write the type declarations to file...
  fs.writeFileSync(
    path.join(path.dirname(target), path.basename(target, ".js") + ".d.ts"),
    dts,
  );
}
