gen: htmldiff.min.js

HTMLDIFF=https://github.com/dfoverdx/htmldiff-js/raw/33500d6df43bfecfc93b44dac69daadcee9d4fdd/dist/htmldiff.min.js

htmldiff.min.js:
	(echo "var module = {exports: {}};" && wget -O- $(HTMLDIFF) && echo && echo "global.HtmlDiff = module.exports['default'];") > htmldiff.min.js

.PHONY: htmldiff.min.js