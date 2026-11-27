// Text modules bundled by wrangler (see "rules" in wrangler.jsonc).
declare module '*.tsv' {
  const content: string;
  export default content;
}
declare module '*.jsontext' {
  const content: string;
  export default content;
}
