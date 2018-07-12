# bringhome

`wget`/`Save page as`-like tool for downloading a web page and its assets to a local directory, rewriting its internal references to relative urls.

## Installation

```
npm install -g bringhome
```

## Usage

```
bringhome https://example.com/ -o localdir

Options:
  --help            Show help                                  [boolean]
  --version         Show version number                        [boolean]
  --output, -o      Directory where results should be written to (or
                    file in --self-contained mode)   [string] [required]
  --recursive, -r   Crawl all HTML-pages linked with relative and root
                    relative links. This stays inside your domain
                                              [boolean] [default: false]
  --omit-scripts    Leave out JavaScript      [boolean] [default: false]
  --self-contained  Inline all assets, producing a single,
                    self-contained "archive" HTML file. Alters the
                    meaning of the --output switch so it specifies the
                    desired location of the file
                                              [boolean] [default: false]
```
