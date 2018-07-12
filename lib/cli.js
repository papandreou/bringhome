#!/usr/bin/env node

require('@gustavnikolaj/async-main-wrap')(require('./main'))(
  process.argv,
  console
);
