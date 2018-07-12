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
    silent
  } = yargs(argv)
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
    'RssChannelLink'
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

  const assetGraph = new AssetGraph();
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

  for (const relation of assetGraph.findRelations({
    hrefType: { $in: ['rootRelative', 'protocolRelative', 'absolute'] }
  })) {
    relation.hrefType = 'relative';
  }

  await assetGraph.moveAssetsInOrder(
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
