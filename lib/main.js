const AssetGraph = require('assetgraph');
const urlTools = require('urltools');
const urlModule = require('url');
const writeFileAsync = require('util').promisify(require('fs').writeFile);
const uniq = require('lodash.uniq');

module.exports = async function cliTool(
  { output, inputUrls, recursive, selfContained, debug },
  console
) {
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
  const root = origins[0];

  const resourceHintTypes = [
    'HtmlPreconnectLink',
    'HtmlPrefetchLink',
    'HtmlPreloadLink',
    'HtmlPrerenderLink',
    'HtmlDnsPrefetchLink'
  ];

  const anchorTypes = ['HtmlAnchor', 'SvgAnchor', 'HtmlMetaRefresh'];

  let followRelationsQuery;
  if (recursive) {
    followRelationsQuery = {
      $or: [
        {
          type: {
            $nin: [
              ...anchorTypes,
              ...resourceHintTypes,
              'HtmlOpenGraph',
              'RssChannelLink'
            ]
          }
        },
        { type: { $nin: resourceHintTypes }, crossorigin: false }
      ]
    };
  } else {
    followRelationsQuery = {
      type: {
        $nin: [
          ...anchorTypes,
          ...resourceHintTypes,
          'HtmlAlternateLink',
          'HtmlOpenGraph',
          'RssChannelLink'
        ]
      }
    };
  }

  const assetGraph = new AssetGraph({ root });
  if (debug) {
    await assetGraph.logEvents();
  }
  await assetGraph.loadAssets(inputUrls);
  await assetGraph.populate({
    followRelations: followRelationsQuery
  });

  await assetGraph.moveAssetsInOrder(
    { isInline: false, isLoaded: true },
    (asset, assetGraph) => {
      let baseUrl;
      if (`${asset.origin}/` === assetGraph.root) {
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

  if (selfContained) {
    await assetGraph.inlineRelations({ to: { isLoaded: true } });

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
      assetGraph.root
    );
  }

  console.log('Output written to', outRoot);
  return assetGraph;
};
