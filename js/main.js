$(function() {

	"use strict";

	const apiUrl = 'https://atlas.ripe.net/api/v2';

	// map of RIPE (IPv4) root system tests per root-letter
	const measurements = {
//		'a':  10309,
//		'b':  10310,
//		'c':  10311,
//		'd':  10312,
//		'e':  10313,
//		'f':  10304,
//		'g':  10314,
//		'h':  10315,
//		'i':  10305,
//		'j':  10316,
//		'k':  10301,
//		'l':  10308,
		'imrs':  10308,
//		'm':  10306
	};

	// map of RSO names
	const rso = {
//		'a': 'Verisign',
//		'b': 'ISI',
//		'c': 'Cogent',
//		'd': 'UMD',
//		'e': 'NASA',
//		'f': 'ISC',
//		'g': 'DISA',
//		'h': 'ARL',
//		'i': 'Netnod',
//		'j': 'Verisign',
//		'k': 'RIPE',
//		'l': 'ICANN',
		'imrs': 'ICANN',
//		'm': 'WIDE'
	};

	// map of regexes that extract the RSO's site-specific code from a hostname.bind string
	const regexes = {
//		'a': /^(?:rootns-|nnn1-)([a-z]{3})\d$/,
//		'b': /^b\d-([a-z]{3})$/,
//		'c': /^([a-z]{3})\d[a-z]\.c\.root-servers\.org$/,
//		'd': /^([a-z]{4})\d\.droot\.maxgigapop\.net$/,
//		'e': /^(?:[a-z]\d+)\.([a-z]{3}[a-z]?)\.eroot$/,
//		'f': /^([a-z]{3})(?:\d[a-z]|\.cf)\.f\.root-servers\.org$/,
//		'g': /^groot-?-(.*?)-.*?(\.net)?$/,
//		'h': /^\d+\.([a-z]{3})\.h\.root-servers\.org$/,
//		'i': /^s\d\.([a-z]{3})$/,
//		'j': /^(?:rootns-(?:el)?|nnn1-)([a-z]{3})\d$/,
//		'k': /^.*?\.([a-z]{2}-[a-z]{3})\.k\.ripe\.net$/,
//		'l': /^([a-z]{2}-[a-z]{3})-[a-z]{2}$/,
		'imrs': /^([a-z]{2}-[a-z]{3})-[a-z]{2}$/,
//		'm': /^m-([a-z]{3})(-[a-z]+)?-\d$/
	};

	// persistent state, to go in the URL
	const state = {};

	// local variables
	let props = {};		// per-probe data
	let view, map;		// openlayers
	let probes;			// openlayers data source object

	//------------------------------------------------------------------
	//
	// persistent state handling functions
	//
	function getDefaults() {
		$.extend(true, state, {
			zoom: 1,
			center: [10, 30],
			top: 1,
			scale: 105,
			letter: 'imrs',
		});
	}

	function getState() {
		var hash = window.location.hash.substr(1);
		if (hash) {
			$.extend(true, state, JSON.parse(window.unescape(hash)));
		}

		// write back to hash
		putState();
	}

	function putState() {
		window.location.hash = JSON.stringify(state);
	}

	//------------------------------------------------------------------
	//
	// functions to handle and record hostname.bind records that do
	// not match the expected regexes
	//
	const mismatches = new Map();

	function logMismatch(probe, letter, hostname) {
		// console.log(`probe ${probe} returned ${hostname} for ${letter}`);
		if (!mismatches.has(hostname)) {
			mismatches.set(hostname, new Map());
		}
		const map = mismatches.get(hostname)

		if (!map.has(letter)) {
			map.set(letter, new Array());
		}
		map.get(letter).push(probe);
	}

	function showMismatches() {
		const hostnames = Array.from(mismatches.keys()).sort();
		for (let hostname of hostnames) {
			const map = mismatches.get(hostname);
			console.log(hostname);
			for (let [letter, list] of map) {
				console.log(letter, list)
			}
		}
	}

	//------------------------------------------------------------------
	//
	// progress bar handling
	//
	const pending = Object.keys(measurements).reduce((p, c) => (p[c] = 1, p), {});

	function showPending() {
		$('#progress').show();
		$('#pending').show().text('Loading: ' + Object.keys(pending).join(' ').toUpperCase());
	}

	function hidePending() {
		$('#progress,#pending').hide();
	}

	//------------------------------------------------------------------
	//
	// AJAX and data handling
	//
	function updateMeasurements(probe, letter, hostname, ms) {
		if (!hostname) return;
		hostname = hostname.toLowerCase();

		const match = regexes[letter].exec(hostname);
		if (!match) {
			logMismatch(probe, letter, hostname);
			return;
		}

		const site = match[1];
		const p = props[probe] = props[probe] || { detail: {} };

		p.detail[letter] = { site, ms };

		// cache fastest entry found
		if (p.fast === undefined || ms < p.fast.ms) {
		  p.fast = { letter, site, ms };
		}
	}

	async function loadMeasurements(letter) {

		const m = measurements[letter];
		const url = `${apiUrl}/measurements/${m}/latest/?fields=responses.0.response_time,responses.0.abuf.answers.0.data.0&freshness=1800`;

		showPending();

		return fetch(url).then(res => res.json()).then(r => {
			for (let [probe, [[ms, site]]] of Object.entries(r)) {
				updateMeasurements(+probe, letter, site, ms);
			}
		}).then(() => {
			delete pending[letter];
			showPending();
		}).then(redraw);

	}

	function loadAllMeasurements() {
		const promises = Object.keys(measurements).map(loadMeasurements);
		return Promise.all(promises);
	}

	//------------------------------------------------------------------
	//
	// per-probe meta-data handling
	//
	const meta = new Map();

	function loadProbeMeta(prb_id) {
		if (!meta.has(prb_id)) {
			const url = `${apiUrl}/probes/${prb_id}/`;
			const data = fetch(url).then(res => res.json());
			meta.set(prb_id, data);
		}
		return meta.get(prb_id);
	}

	function showProbeMeta(prb_id) {

		let output = `Probe #${prb_id}`;
		$('#meta').text(output);

		loadProbeMeta(prb_id).then(meta => {
			output += `, AS${meta.asn_v4}`;
			$('#meta').text(output);
		});
	}

	//------------------------------------------------------------------
	//
	// per-probe styling
	//
	const styles = new Map();						// style cache

	function getColour(ms, scale) {
		let r = Math.min(ms, scale) / scale;	// 0 .. 1
		r = Math.pow(r, 1.2);					// non-linear. And a bit bigger
		const h = Math.floor(120 * (1 - r));	// 120 .. 0

		return [h, `hsla(${h}, 60%, 40%, 0.6)`];
	}

	function getProbeStyle(feature, resolution) {

		const id = feature.getId();
		const p = props[id];
		if (!p) return;

		// vary circle size by zoom factor
		let size = Math.max(3, Math.min(6, Math.floor(20000 / resolution)));
		size = Math.floor(10 * size) / 10.0;

		let ms;
		if (state.letter) {
			const d = p.detail[state.letter];
			if (!d) return;
			ms = d.ms;
		} else if (state.top === 1) {						// short cut
			ms = p.fast.ms;
		} else {
			const times = Object.values(p.detail).map(o => o.ms).sort((a, b) => a - b);
			const index = Math.min(state.top - 1, times.length - 1);
			ms = times[index];
		}

		const [h, col] = getColour(ms, state.scale);
		const key = (state.letter || '#') + '|' + state.scale + '|' + h + '|' + size.toFixed(1);

		if (!styles.has(key)) {
			const s = new ol.style.Style({
				image: new ol.style.Circle({
					radius: size,
					fill: new ol.style.Fill({color: col}),
				}),
				zIndex: ms
			});
			styles.set(key, s);
		}

		return styles.get(key);
	}

	//------------------------------------------------------------------

	function showProbeMeasurements(prb_id) {
		const p = props[prb_id];
		const { letter, ms, site } = p.fast;

		const detail = Array.from(Object.entries(p.detail))
			.sort((a, b) => a[1].ms - b[1].ms)
			.map(([k, v]) => `${k.toUpperCase()}: ${v.ms.toFixed(1)} (${v.site.toUpperCase()})`)
			.join(', ');

		$('#measurements').text(detail);
	}

	function buildMap() {

		view = new ol.View({
			center: ol.proj.fromLonLat(state.center),
			zoom: state.zoom,
			minZoom: 2,
			maxZoom: 14,
			loadTilesWhileInteracting: true
		});

		map = new ol.Map({
			target: 'map',
			layers: [
				new ol.layer.Tile({
					source: new ol.source.OSM({
						url: 'https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png'
					})
				})
			],
			view: view
		});

		$('#progress').show();
		$('#pending').show().text('Loading: probe locations');

		probes = new ol.source.Vector({
			url: `${apiUrl}/cartography/locations`,
			format: new ol.format.GeoJSON(),
			attributions: 'Data from <a href="https://atlas.ripe.net/" target="_blank">RIPE Atlas</a>.'
		});

		map.addLayer(
			new ol.layer.Vector({
					renderMode: 'image',
					source: probes,
					style: getProbeStyle
			})
		);

		map.on('pointermove', mouseOver);

		view.on(['change:center', 'change:resolution'], _.debounce(changeView, 250));
	}

	// force the probe layer to be redrawn by faking a 'change' event
	function redraw() {
		if (probes) {
			probes.dispatchEvent('change');
		}
	}

	//------------------------------------------------------------------
	//
	// event handlers
	//

	function changeView(evt) {
		var view = evt.target;
		state.zoom = view.getZoom();
		state.center = ol.proj.toLonLat(view.getCenter());
		putState();
	}

	function changeTop(evt) {
		state.top = +evt.target.value;
		putState();
		redraw();
	}

	function changeScale(evt) {
		state.scale = +evt.target.value;
		putState();
		redraw();
	}

	function changeLetter(evt) {
		state.letter = evt.target.value || undefined;
		$('#rinput').prop('disabled', !!state.letter);
		putState();
		redraw();
	}

	function displayTop() {
		let v = +this.value;

		let suff = "th";
		switch (v) {
			case 1: suff = ""; v = ""; break;
			case 2: suff = "nd"; break;
			case 3: suff = "rd"; break;
		}

		$('#rlabel').text(`Color by ${v}${suff} Fastest`);
	}

	function displayScale() {
		$('#slabel').text(`Latency range 0 - ${this.value} ms`);
	}

	function mouseOver(evt) {

		const prb_id = this.forEachFeatureAtPixel(evt.pixel, (feature, layer) => feature.getId());
		if (prb_id === undefined) {
			$('#map').css('cursor', '');
			$('#meta,#measurements').hide();
		} else {
			$('#map').css('cursor', 'pointer');
			$('#meta,#measurements').show();
			showProbeMeta(prb_id);
			showProbeMeasurements(prb_id);
		}
	}

	//------------------------------------------------------------------

	function setupLegend() {
		const canvas = document.getElementById('legend');
		const ctx = canvas.getContext('2d');
		for (let x = 0; x < canvas.width; ++x) {
			const [h, col] =  getColour(x, canvas.width - 1);
			ctx.strokeStyle = col;
			ctx.strokeRect(x, 0, x, canvas.height);
		}
	}

	//------------------------------------------------------------------

	function setupSliders() {
		const n = Object.keys(measurements).length;

		for (let i = 1; i <= n; ++i) {
			$('<option>', { value: i, label: (i % 2 == 1) ? i : undefined}).appendTo('#rticks');
		}

		$('#rinput')
			.on('change', changeTop)
			.on('change input', displayTop)
			.attr('max', n)
			.val(state.top)
			.trigger('input');

		$('#sinput')
			.on('change', changeScale)
			.on('change input', displayScale)
			.val(state.scale)
			.trigger('input');
	}

	//------------------------------------------------------------------

	function setupLetters() {

		for (const [l, o] of Object.entries(rso)) {
			$('<option>', {
				value: l,
				text: `${l.toUpperCase()} (${o})`,
				selected: state.letter == l
			}).appendTo('#letter');
		}

		$('#letter')
			.on('change', changeLetter)
			.val(state.letter)
			.trigger('change');
	}

	//------------------------------------------------------------------
	//
	// main application startup
	//
	getDefaults();
	getState();
	setupLegend();
	setupSliders();
	setupLetters();
	buildMap();

	// once the main data source has loaded, one-off trigger to get the other data
	probes.once('change', async () => {
		await loadAllMeasurements();
		showMismatches();
		hidePending();
	});
});
