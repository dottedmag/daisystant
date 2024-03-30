.PHONY: dist

build: gen
	web-ext build

gen: htmldiff.min.js

HTMLDIFF=https://github.com/dfoverdx/htmldiff-js/raw/33500d6df43bfecfc93b44dac69daadcee9d4fdd/dist/htmldiff.min.js

htmldiff.min.js:
	(echo "var module = {exports: {}};" && wget -O- $(HTMLDIFF) && echo && echo "global.HtmlDiff = module.exports['default'];") > htmldiff.min.js

clean:
	rm -rf web-ext-artifacts

deploy: dist
	rsync -ar --progress --delete dist/ tea:/srv/www/daisystant

dist:
	rm -rf dist
	mkdir -p dist
	tailwind -c web/tailwind.config.js -i web/main.css.in -o dist/main.css
	cp web/index.html web/updates.json web/*.xpi dist

watch:
	tailwind -c web/tailwind.config.js -i web/main.css.in -o web/main.css --watch
