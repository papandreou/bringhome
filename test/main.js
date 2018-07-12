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

    await main(['-s', '-o', outputDir, 'https://example.com/'], console);

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
            <body>
              <script src="/scripts/script.js"></script>
            </body>
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

    await main(['-s', '-o', outputDir, 'https://example.com/'], console);

    expect(
      await readdirAsync(pathModule.resolve(outputDir, 'scripts')),
      'to equal',
      ['script.js']
    );

    expect(
      await readFileAsync(pathModule.resolve(outputDir, 'index.html'), 'utf-8'),
      'to contain',
      '<script src="scripts/script.js">'
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

  it('should convert root-relative and absolute urls to relative ones', async function() {
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
            <body>
              <script src="/scripts/script.js"></script>
              <script src="https://example.com/scripts/script.js"></script>
              <script src="//example.com/scripts/script.js"></script>
            </body>
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

    await main(['-s', '-o', outputDir, 'https://example.com/'], console);

    const html = await readFileAsync(
      pathModule.resolve(outputDir, 'index.html'),
      'utf-8'
    );

    expect(html, 'not to contain', 'file:');
    expect(
      html.match(/<script src="scripts\/script\.js">/g),
      'to have length',
      3
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
            <body><script src="https://thirdparty.com/scripts/script.js"></script>
            </body>
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

    await main(['-s', '-o', outputDir, 'https://example.com/'], console);

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

  describe('in selfContained:true mode', function() {
    it('should inline all referenced assets and output a single file', async function() {
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
              <body><script src="scripts/script.js"></script>
              </body>
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
        [
          '-s',
          '--self-contained',
          '-o',
          `${outputDir}/single.html`,
          'https://example.com/'
        ],
        console
      );

      expect(await readdirAsync(pathModule.resolve(outputDir)), 'to equal', [
        'single.html'
      ]);

      expect(
        await readFileAsync(
          pathModule.resolve(outputDir, 'single.html'),
          'utf-8'
        ),
        'to contain',
        `alert('Hello, world!');`
      );
    });
  });

  describe('in omitScripts:true mode', function() {
    it('should strip references to JavaScript', async function() {
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
              <body><script src="scripts/script.js"></script>
              </body>
              </html>
            `
          }
        }
      ]);

      await main(
        ['-s', '--omit-scripts', '-o', outputDir, 'https://example.com/'],
        console
      );

      expect(await readdirAsync(pathModule.resolve(outputDir)), 'to equal', [
        'index.html'
      ]);

      expect(
        await readFileAsync(
          pathModule.resolve(outputDir, 'index.html'),
          'utf-8'
        ),
        'not to contain',
        `<script`
      );
    });
  });

  describe('with --header|-H', function() {
    it('should accept one custom header', async function() {
      httpception([
        {
          request: {
            url: 'GET https://example.com/',
            headers: {
              Foo: 123
            }
          },
          response: {
            headers: {
              'Content-Type': 'text/html; charset=utf-8'
            },
            body: '<!DOCTYPE html><html><head></head><body></body></html>'
          }
        }
      ]);

      await main(
        ['-s', '-H', 'foo:123', '-o', outputDir, 'https://example.com/'],
        console
      );
    });

    it('should accept two different custom headers', async function() {
      httpception([
        {
          request: {
            url: 'GET https://example.com/',
            headers: {
              Foo: 123,
              bar: 'quux'
            }
          },
          response: {
            headers: {
              'Content-Type': 'text/html; charset=utf-8'
            },
            body: '<!DOCTYPE html><html><head></head><body></body></html>'
          }
        }
      ]);

      await main(
        [
          '-s',
          '-H',
          'foo:123',
          '-H',
          'bar: quux',
          '-o',
          outputDir,
          'https://example.com/'
        ],
        console
      );
    });

    it('should accept three values of the same header', async function() {
      httpception([
        {
          request: {
            url: 'GET https://example.com/',
            headers: {
              // Would probably be better if this ended up as three separate headers, but that'll require fixes in teepee:
              Foo: 'bar, quux, baz'
            }
          },
          response: {
            headers: {
              'Content-Type': 'text/html; charset=utf-8'
            },
            body: '<!DOCTYPE html><html><head></head><body></body></html>'
          }
        }
      ]);

      await main(
        [
          '-s',
          '-H',
          'Foo: bar',
          '-H',
          'Foo: quux',
          '-H',
          'Foo: baz',
          '-o',
          outputDir,
          'https://example.com/'
        ],
        console
      );
    });
  });
});
