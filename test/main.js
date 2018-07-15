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
          body:
            '<!DOCTYPE html><html><head></head><body><p>Hello, world!</p></body></html>'
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

  it('should assume http:// when no protocol:// is passed (like curl)', async function() {
    httpception([
      {
        request: 'GET http://example.com/',
        response: {
          headers: {
            'Content-Type': 'text/html; charset=utf-8'
          },
          body: '<!DOCTYPE html><html><head></head><body></body></html>'
        }
      }
    ]);

    await main(['-s', '-o', outputDir, 'example.com'], console);
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

  it('should ensure that the downloaded files have an extension (to make them more likely to be served with the correct C-T)', async function() {
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
              <script src="script"></script>
            </body>
            </html>
          `
        }
      },
      {
        request: 'GET https://example.com/script',
        response: {
          headers: {
            'Content-Type': 'application/javascript'
          },
          body: "alert('script');"
        }
      }
    ]);

    await main(['-s', '-o', outputDir, 'https://example.com/'], console);

    expect(await readdirAsync(outputDir), 'to equal', [
      'index.html',
      'script.js'
    ]);
  });

  it('should not break when an asset collides with the name of a directory', async function() {
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
              <script src="script.js"></script>
              <script src="script.js/bar.js/quux.js"></script>
              <script src="script.js/bar.js"></script>
              <script src="script.js/bar.js/quux.js/baz.js"></script>
              <script src="script.js/foo.js"></script>
            </body>
            </html>
          `
        }
      },
      {
        request: 'GET https://example.com/script.js',
        response: {
          headers: {
            'Content-Type': 'application/javascript'
          },
          body: "alert('script');"
        }
      },
      {
        request: 'GET https://example.com/script.js/bar.js/quux.js',
        response: {
          headers: {
            'Content-Type': 'application/javascript'
          },
          body: "alert('bar/quux');"
        }
      },
      {
        request: 'GET https://example.com/script.js/bar.js',
        response: {
          headers: {
            'Content-Type': 'application/javascript'
          },
          body: "alert('bar');"
        }
      },
      {
        request: 'GET https://example.com/script.js/bar.js/quux.js/baz.js',
        response: {
          headers: {
            'Content-Type': 'application/javascript'
          },
          body: "alert('bar/quux/baz');"
        }
      },
      {
        request: 'GET https://example.com/script.js/foo.js',
        response: {
          headers: {
            'Content-Type': 'application/javascript'
          },
          body: "alert('foo');"
        }
      }
    ]);

    await main(['-s', '-o', outputDir, 'https://example.com/'], console);

    expect(await readdirAsync(outputDir), 'to equal', [
      'index.html',
      'script-1.js',
      'script.js'
    ]);

    expect(
      await readdirAsync(pathModule.resolve(outputDir, 'script.js')),
      'to equal',
      ['bar-1.js', 'bar.js', 'foo.js']
    );

    expect(
      await readdirAsync(pathModule.resolve(outputDir, 'script.js', 'bar.js')),
      'to equal',
      ['quux-1.js', 'quux.js']
    );

    expect(
      await readdirAsync(
        pathModule.resolve(outputDir, 'script.js', 'bar.js', 'quux.js')
      ),
      'to equal',
      ['baz.js']
    );

    expect(
      await readFileAsync(
        pathModule.resolve(outputDir, 'script.js', 'foo.js'),
        'utf-8'
      ),
      'to contain',
      "alert('foo');"
    );

    expect(
      await readFileAsync(
        pathModule.resolve(outputDir, 'script-1.js'),
        'utf-8'
      ),
      'to contain',
      "alert('script');"
    );
  });

  it('should handle cyclic references', async function() {
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
            <body><script src="script.js"></script>
            </body>
            </html>
          `
        }
      },
      {
        request: 'GET https://example.com/script.js',
        response: {
          headers: {
            'Content-Type': 'application/javascript'
          },
          body:
            "alert('Hello, look over there: ' + 'anotherscript.js'.toString('url'));"
        }
      },
      {
        request: 'GET https://example.com/anotherscript.js',
        response: {
          headers: {
            'Content-Type': 'application/javascript'
          },
          body: "alert('And here: ' + 'script.js'.toString('url'));"
        }
      }
    ]);

    await main(['-s', '-o', outputDir, 'https://example.com/'], console);

    expect(
      await readFileAsync(pathModule.resolve(outputDir, 'script.js'), 'utf-8'),
      'to contain',
      "alert('Hello, look over there: ' + 'anotherscript.js'.toString('url'));"
    );

    expect(
      await readFileAsync(
        pathModule.resolve(outputDir, 'anotherscript.js'),
        'utf-8'
      ),
      'to contain',
      "alert('And here: ' + 'script.js'.toString('url'));"
    );
  });

  describe('with http redirects', function() {
    it('should handle a redirect of the entry point', async function() {
      httpception([
        {
          request: 'GET http://example.com/',
          response: {
            statusCode: 301,
            headers: {
              Location: 'https://somewhereelse.com/'
            }
          }
        },
        {
          request: 'GET https://somewhereelse.com/',
          response: {
            headers: {
              'Content-Type': 'text/html; charset=utf-8'
            },
            body: `
              <!DOCTYPE html>
              <html>
              <head></head>
              <body><script src="script.js"></script>
              </body>
              </html>
            `
          }
        },
        {
          request: 'GET https://somewhereelse.com/script.js',
          response: {
            headers: {
              'Content-Type': 'application/javascript'
            },
            body: "alert('Hello, world!');"
          }
        }
      ]);

      await main(['-s', '-o', outputDir, 'http://example.com/'], console);

      expect(await readdirAsync(outputDir), 'to equal', [
        'index.html',
        'script.js'
      ]);

      expect(
        await readFileAsync(
          pathModule.resolve(outputDir, 'index.html'),
          'utf-8'
        ),
        'to contain',
        `<script src="script.js">`
      );

      expect(
        await readFileAsync(
          pathModule.resolve(outputDir, 'script.js'),
          'utf-8'
        ),
        'to contain',
        `alert('Hello, world!');`
      );
    });

    it('should rewrite the incoming relations to point at the target asset', async function() {
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
            statusCode: 301,
            headers: {
              Location: 'https://example.com/some/other/script.js'
            }
          }
        },
        {
          request: 'GET https://example.com/some/other/script.js',
          response: {
            headers: {
              'Content-Type': 'application/javascript'
            },
            body: "alert('Hello, world!');"
          }
        }
      ]);

      await main(['-s', '-o', outputDir, 'https://example.com/'], console);

      expect(
        await readdirAsync(pathModule.resolve(outputDir, 'some', 'other')),
        'to equal',
        ['script.js']
      );

      expect(await readdirAsync(outputDir), 'to equal', ['index.html', 'some']);

      expect(
        await readFileAsync(
          pathModule.resolve(outputDir, 'some', 'other', 'script.js'),
          'utf-8'
        ),
        'to contain',
        `alert('Hello, world!');`
      );
    });
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

    it('should unwrap <noscript> ... </noscript> blocks', async function() {
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
              <body><noscript>foo<span>bar</span>quux</noscript></body>
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
        'to contain',
        '<body>foo<span>bar</span>quux'
      ).and('not to contain', 'noscript');
    });

    it('should rewrite relations found in the <noscript> blocks', async function() {
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
              <body><noscript><link rel="stylesheet" href="https://3rdparty.com/styles.css"></noscript></body>
              </html>
            `
          }
        },
        {
          request: 'GET https://3rdparty.com/styles.css',
          response: {
            headers: {
              'Content-Type': 'text/css'
            },
            body: 'body { color: maroon; }'
          }
        }
      ]);

      await main(
        ['-s', '--omit-scripts', '-o', outputDir, 'https://example.com/'],
        console
      );

      expect(await readdirAsync(pathModule.resolve(outputDir)), 'to equal', [
        '3rdparty.com',
        'index.html'
      ]);

      expect(
        await readFileAsync(
          pathModule.resolve(outputDir, 'index.html'),
          'utf-8'
        ),
        'to contain',
        '<link rel="stylesheet" href="3rdparty.com/styles.css">'
      ).and('not to contain', 'noscript');
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

  describe('with --pretty', function() {
    it('should pretty-print assets', async function() {
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
              <body><script src="script.js"></script>
              </body>
              </html>
            `
          }
        },
        {
          request: 'GET https://example.com/script.js',
          response: {
            headers: {
              'Content-Type': 'application/javascript'
            },
            body: `function greeter(){alert('Hello, world!');}greeter()`
          }
        }
      ]);

      await main(
        ['-s', '--pretty', '-o', outputDir, 'https://example.com/'],
        console
      );

      expect(
        await readFileAsync(
          pathModule.resolve(outputDir, 'script.js'),
          'utf-8'
        ),
        'to equal',
        "function greeter() {\n    alert('Hello, world!');\n}\ngreeter();"
      );
    });
  });
});
