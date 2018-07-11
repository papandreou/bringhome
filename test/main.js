const main = require('../lib/main');
const httpception = require('httpception');
const promisify = require('util').promisify;
const rimrafAsync = promisify(require('rimraf'));
const fs = require('fs');
const readFileAsync = promisify(fs.readFile);
const mkdirAsync = promisify(fs.mkdir);
const readdirAsync = promisify(fs.readdir);
const getTemporaryFilePath = require('gettemporaryfilepath');
const expect = require('unexpected')
  .clone()
  .use(require('unexpected-sinon'));
const sinon = require('sinon');
const pathModule = require('path');

describe('main', function() {
  let outputDir;
  let console;
  beforeEach(async function() {
    outputDir = getTemporaryFilePath();
    await mkdirAsync(outputDir);
    console = { log: sinon.spy() };
  });

  afterEach(async function() {
    await rimrafAsync(outputDir);
  });

  it('should download a web page and save it in a local directory', async function() {
    httpception([
      {
        request: 'GET https://example.com/',
        response: {
          headers: {
            'Content-Type': 'text/html; charset=utf-8'
          },
          body: `
            <!DOCTYPE html><html><head></head><body><p>Hello, world!</p></body></html>
          `
        }
      }
    ]);

    await main(
      {
        inputUrls: ['https://example.com/'],
        output: outputDir
      },
      console
    );

    expect(await readdirAsync(outputDir), 'to equal', ['index.html']);

    expect(
      await readFileAsync(pathModule.resolve(outputDir, 'index.html'), 'utf-8'),
      'to contain',
      'Hello, world!'
    );
  });

  it('should download first party referenced assets and mirror the directory structure locally', async function() {
    httpception([
      {
        request: 'GET https://example.com/',
        response: {
          headers: {
            'Content-Type': 'text/html; charset=utf-8'
          },
          body: `
            <!DOCTYPE html>
            <html>
            <head></head>
            <body><script src="/scripts/script.js"></body>
            </html>
          `
        }
      },
      {
        request: 'GET https://example.com/scripts/script.js',
        response: {
          headers: {
            'Content-Type': 'application/javascript'
          },
          body: `
            alert('Hello, world!');
          `
        }
      }
    ]);

    await main(
      {
        inputUrls: ['https://example.com/'],
        output: outputDir
      },
      console
    );

    expect(
      await readdirAsync(pathModule.resolve(outputDir, 'scripts')),
      'to equal',
      ['script.js']
    );

    expect(
      await readFileAsync(
        pathModule.resolve(outputDir, 'scripts', 'script.js'),
        'utf-8'
      ),
      'to contain',
      `alert('Hello, world!');`
    );
  });

  it('should download third party referenced assets and store them locally in a structure that reflects the original origins', async function() {
    httpception([
      {
        request: 'GET https://example.com/',
        response: {
          headers: {
            'Content-Type': 'text/html; charset=utf-8'
          },
          body: `
            <!DOCTYPE html>
            <html>
            <head></head>
            <body><script src="https://thirdparty.com/scripts/script.js"></body>
            </html>
          `
        }
      },
      {
        request: 'GET https://thirdparty.com/scripts/script.js',
        response: {
          headers: {
            'Content-Type': 'application/javascript'
          },
          body: `
            alert('Hello, world!');
          `
        }
      }
    ]);

    await main(
      {
        inputUrls: ['https://example.com/'],
        output: outputDir
      },
      console
    );

    expect(
      await readdirAsync(
        pathModule.resolve(outputDir, 'thirdparty.com', 'scripts')
      ),
      'to equal',
      ['script.js']
    );

    expect(
      await readFileAsync(
        pathModule.resolve(outputDir, 'thirdparty.com', 'scripts', 'script.js'),
        'utf-8'
      ),
      'to contain',
      `alert('Hello, world!');`
    );
  });
});
