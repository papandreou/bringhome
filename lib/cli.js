#!/usr/bin/env node

const yargs = require('yargs');
const {
  output,
  _: inputUrls,
  'omit-scripts': omitScripts,
  recursive,
  'self-contained': selfContained
} = yargs
  .usage('$0 https://example.com/ -o localdir')
  .options('output', {
    alias: 'o',
    describe:
      'Directory where results should be written to (or file in --self-contained mode)',
    type: 'string',
    demand: true
  })
  .options('recursive', {
    alias: 'r',
    describe:
      'Crawl all HTML-pages linked with relative and root relative links. This stays inside your domain',
    type: 'boolean',
    default: true
  })
  .options('omit-scripts', {
    describe: 'Leave out JavaScript',
    type: 'boolean',
    default: false
  })
  .options('self-contained', {
    describe: 'Inline all assets, producing a self-contained "archive"',
    type: 'boolean',
    default: false
  })
  .options('no-recursive', {
    describe: 'Do not crawl recursively. Opposite of --recursive option.',
    type: 'boolean',
    default: false
  })
  .demand(1)
  .check(({ _ }) => _.every(arg => /^https?:\/\//i.test(arg)))
  .wrap(72).argv;

require('@gustavnikolaj/async-main-wrap')(require('./main'))(
  {
    output,
    inputUrls,
    recursive,
    selfContained,
    omitScripts,
    debug: true
  },
  console
);
