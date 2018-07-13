const AssetGraph = require('assetgraph');
const urlTools = require('urltools');
const urlModule = require('url');
const writeFileAsync = require('util').promisify(require('fs').writeFile);
const uniq = require('lodash.uniq');
const yargs = require('yargs');

module.exports = async function cliTool(argv, console) {
  const {
    output,
    _: inputUrls,
    'omit-scripts': omitScripts,
    recursive,
    'self-contained': selfContained,
    silent,
    header: headers
  } = yargs(argv)
    .usage('$0 https://example.com/ -o localdir')
    .options('output', {
      alias: 'o',
      describe:
        'Directory where results should be written to (or file in --self-contained mode)',
      type: 'string',
      demand: true
    })
    .options('header', {
      alias: 'H',
      describe:
        "Specify a custom header and value to pass when retrieving assets, eg. -H 'Foo: bar'. Can be repeated",
      type: 'string',
      array: true,
      default: []
    })
    .options('recursive', {
      alias: 'r',
      describe:
        'Crawl all HTML-pages linked with relative and root relative links. This stays inside your domain',
      type: 'boolean',
      default: false
    })
    .options('omit-scripts', {
      describe: 'Leave out JavaScript',
      type: 'boolean',
      default: false
    })
    .options('self-contained', {
      describe:
        'Inline all assets, producing a single, self-contained "archive" HTML file. Alters the meaning of the --output switch so it specifies the desired location of the file',
      type: 'boolean',
      default: false
    })
    .options('silent', {
      alias: 's',
      describe: 'Do not write anything to stdout',
      type: 'boolean',
      default: false
    })
    .demand(1)
    .check(({ _ }) => _.every(arg => /^https?:\/\//i.test(arg)))
    .wrap(72).argv;

  if (selfContained && inputUrls.length > 1) {
    throw new Error('--self-contained mode only supports a single input url');
  }

  const assetGraph = new AssetGraph();
  const teepeeHeaders = assetGraph.teepee.headers;
  for (const header of headers) {
    var matchKeyValue = header.match(/^([^:]*):\s?(.*)$/);
    if (matchKeyValue) {
      const [, name, value] = matchKeyValue;
      if (Array.isArray(teepeeHeaders[name])) {
        teepeeHeaders[name].push(value);
      } else if (teepeeHeaders[name] === undefined) {
        teepeeHeaders[name] = value;
      } else {
        teepeeHeaders[name] = [teepeeHeaders[name], value];
      }
    } else {
      throw new Error('Cannot parse header: ' + header);
    }
  }

  // In selfContained mode this will come out as file:///path/to/index.html/
  // We'll deal with that case further below
  const outRoot = output && urlTools.urlOrFsPathToUrl(output, true);

  const origins = uniq(
    inputUrls.map(inputUrl => new urlModule.URL(inputUrl).origin)
  );
  if (origins.length > 1) {
    throw new Error(
      'The pages to bring home must have the same origin, but saw multiple:\n  ' +
        origins.join('\n  ')
    );
  }
  const origin = origins[0];

  const resourceHintTypes = [
    'HtmlPreconnectLink',
    'HtmlPrefetchLink',
    'HtmlPreloadLink',
    'HtmlPrerenderLink',
    'HtmlDnsPrefetchLink'
  ];

  const omitTypes = [];
  if (omitScripts) {
    omitTypes.push('HtmlScript', 'SvgScript', 'HtmlInlineEventHandler');
  }

  const anchorTypes = ['HtmlAnchor', 'SvgAnchor', 'HtmlMetaRefresh'];

  const noFollowRelationTypes = [
    ...anchorTypes,
    ...resourceHintTypes,
    ...omitTypes,
    'HtmlOpenGraph',
    'RssChannelLink',
    'JsonUrl'
  ];

  let followRelationsQuery;
  if (recursive) {
    followRelationsQuery = {
      $or: [
        {
          type: {
            $nin: noFollowRelationTypes
          }
        },
        { type: { $nin: resourceHintTypes }, crossorigin: false }
      ]
    };
  } else {
    noFollowRelationTypes.push('HtmlAlternateLink');
    followRelationsQuery = {
      type: {
        $nin: noFollowRelationTypes
      }
    };
  }

  if (silent) {
    // Avoid
    assetGraph.on('warn', () => {});
  } else {
    await assetGraph.logEvents();
  }
  await assetGraph.loadAssets(inputUrls);
  await assetGraph.populate({
    followRelations: followRelationsQuery
  });

  for (const redirect of assetGraph.findRelations({
    type: 'HttpRedirect'
  })) {
    for (const incomingRelation of redirect.from.incomingRelations) {
      incomingRelation.to = redirect.to;
    }
    assetGraph.removeAsset(redirect.from);
  }

  for (const relation of assetGraph.findRelations({
    hrefType: { $in: ['rootRelative', 'protocolRelative', 'absolute'] }
  })) {
    relation.hrefType = 'relative';
  }

  await assetGraph.moveAssets(
    { isInline: false, isLoaded: true },
    (asset, assetGraph) => {
      let baseUrl;
      if (asset.origin === origin) {
        baseUrl = outRoot;
      } else {
        baseUrl = `${outRoot}${asset.hostname}${
          asset.port ? `:${asset.port}` : ''
        }/`;
      }
      return urlModule.resolve(
        baseUrl,
        `${asset.path.replace(/^\//, '')}${asset.fileName ||
          `index${asset.defaultExtension}`}`
      );
    }
  );

  if (omitTypes.length > 0) {
    for (const relation of assetGraph.findRelations({
      type: { $in: omitTypes }
    })) {
      relation.detach();
    }
  }

  if (selfContained) {
    await assetGraph.inlineRelations({
      to: { isLoaded: true },
      type: {
        $nin: [...noFollowRelationTypes, 'SourceMapFile', 'SourceMapSource']
      }
    });

    await writeFileAsync(
      output,
      assetGraph.findAssets({ isInitial: true })[0].rawSrc
    );
  } else {
    await assetGraph.writeAssetsToDisc(
      {
        isLoaded: true,
        url: url => url.startsWith(outRoot)
      },
      outRoot,
      outRoot
    );
  }

  if (!silent) {
    console.log('Output written to', outRoot);
  }
};
