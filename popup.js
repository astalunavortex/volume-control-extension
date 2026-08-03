(async function() {
	// ======== ЭЛЕМЕНТЫ ========
	const slider = document.getElementById('volumeSlider');
	const volumeValue = document.getElementById('volumeValue');
	const muteBtn = document.getElementById('muteBtn');
	const resetBtn = document.getElementById('resetBtn');
	const settingsBtn = document.getElementById('settingsBtn');
	const settingsPanel = document.getElementById('settingsPanel');
	const modeOptions = document.querySelectorAll('.mode-option');
	const presets = document.querySelectorAll('.preset');
	const colorSwatch = document.getElementById("colorSwatch")
	const colorValue = document.getElementById('colorValue');
	const muteIcon = document.getElementById('muteIcon');
	const muteText = document.getElementById('muteText');

	// ======== СОСТОЯНИЕ ========
	let state = {
		volume: 100,
		muted: false,
		prevVolume: 100,
		displayMode: 'percent',
		accentColor: '#eaeaea',
		tabId: null
	};

	// ======== УТИЛИТЫ ========
	function percentToDb(percent) {
		if (percent <= 0) return -Infinity;
		const gain = percent / 100;
		const db = 20 * Math.log10(gain);
		return Math.round(db * 10) / 10;
	}

	function formatValue(percent, mode) {
		if (state.muted) {
			return mode === 'percent' ? '0%' : '-∞ dB';
		}
		if (mode === 'percent') {
			return percent + '%';
		} else {
			const db = percentToDb(percent);
			if (db === -Infinity) return '-∞ dB';
			const sign = db >= 0 ? '+' : '';
			return sign + db.toFixed(1) + ' dB';
		}
	}

	function hexToRgb(hex) {
		const r = parseInt(hex.slice(1, 3), 16);
		const g = parseInt(hex.slice(3, 5), 16);
		const b = parseInt(hex.slice(5, 7), 16);
		return { r, g, b };
	}

	function applyAccentColor(color) {
		const rgb = hexToRgb(color);
		const style = document.documentElement.style;
		style.setProperty('--accent', color);
		style.setProperty('--accent-rgb', `${rgb.r}, ${rgb.g}, ${rgb.b}`);
		if (colorValue) colorValue.value = color.toUpperCase();
	}

	// ======== ОБНОВЛЕНИЕ UI ========
	function updateUI() {
		const displayVol = state.muted ? 0 : state.volume;

		slider.value = displayVol;
		slider.style.setProperty('--progress', (displayVol / 2) + '%');

		volumeValue.textContent = formatValue(displayVol, state.displayMode);
		volumeValue.classList.toggle('muted', state.muted);

		muteBtn.classList.toggle('muted', state.muted);
		muteIcon.setAttribute('href', state.muted ? '#icon-muted' : '#icon-unmuted');
		muteText.textContent = state.muted ? 'Unmute' : 'Mute';

		presets.forEach(p => {
			const val = parseInt(p.dataset.value);
			p.classList.toggle('active', val === displayVol);
		});

		modeOptions.forEach(m => {
			m.classList.toggle('active', m.dataset.mode === state.displayMode);
		});
	}

	// ======== ПРИМЕНЕНИЕ К СТРАНИЦЕ ========
	async function applyVolume() {
		if (!state.tabId) return;

		const targetGain = state.muted ? 0 : state.volume / 100;

		try {
			await browser.scripting.executeScript({
				target: { tabId: state.tabId },
				func: (targetGain) => {
					if (!window.__vcAudioCtx) {
						window.__vcAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
					}
					const ctx = window.__vcAudioCtx;

					if (!window.__vcGainNode) {
						window.__vcGainNode = ctx.createGain();
						window.__vcGainNode.gain.value = 1.0;
						window.__vcGainNode.connect(ctx.destination);
					}
					const gainNode = window.__vcGainNode;

					function collectMedia(root) {
						const media = [];
						root.querySelectorAll('audio, video').forEach(el => media.push(el));
						root.querySelectorAll('*').forEach(el => {
							if (el.shadowRoot) media.push(...collectMedia(el.shadowRoot));
						});
						return media;
					}

					const allMedia = collectMedia(document);

					allMedia.forEach(el => {
						if (el.__vcConnected) return;

						try {
							const source = ctx.createMediaElementSource(el);
							source.connect(gainNode);
							el.__vcConnected = true;
							el.__vcSource = source;
						} catch (e) {
							console.warn('VC: Failed to connect media element:', e);
						}
					});

					const now = ctx.currentTime;
					gainNode.gain.cancelScheduledValues(now);
					gainNode.gain.setTargetAtTime(targetGain, now, 0.05);

					if (!window.__vcObserver) {
						window.__vcObserver = new MutationObserver((mutations) => {
							const newMedia = [];
							mutations.forEach(mutation => {
								mutation.addedNodes.forEach(node => {
									if (node.nodeType === Node.ELEMENT_NODE) {
										if (node.matches && (node.matches('audio') || node.matches('video'))) {
											newMedia.push(node);
										}
										if (node.querySelectorAll) {
											node.querySelectorAll('audio, video').forEach(el => newMedia.push(el));
										}
									}
								});
							});

							newMedia.forEach(el => {
								if (el.__vcConnected) return;
								try {
									const source = ctx.createMediaElementSource(el);
									source.connect(gainNode);
									el.__vcConnected = true;
									el.__vcSource = source;
								} catch (e) {}
							});
						});

						window.__vcObserver.observe(document.body, {
							childList: true,
							subtree: true
						});
					}

					return { success: true, elements: allMedia.length, gain: targetGain };
				},
				args: [targetGain]
			});
		} catch (err) {
			console.error('Volume control error:', err);
		}
	}

	// ======== СОХРАНЕНИЕ/ЗАГРУЗКА ========
	async function loadTabVolume() {
		const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
		if (!tab?.id) return;
		state.tabId = tab.id;

		const key = `vc_tab_${tab.id}`;
		const result = await browser.storage.local.get([key, 'vc_displayMode', 'vc_accentColor']);

		if (result[key]) {
			state.volume = result[key].volume ?? 100;
			state.muted = result[key].muted ?? false;
			state.prevVolume = result[key].prevVolume ?? 100;
		} else {
			state.volume = 100;
			state.muted = false;
			state.prevVolume = 100;
		}

		state.displayMode = result.vc_displayMode || 'percent';
		state.accentColor = result.vc_accentColor || '#eaeaea';
		applyAccentColor(state.accentColor);
	}

	async function saveTabVolume() {
		if (!state.tabId) return;
		const key = `vc_tab_${state.tabId}`;
		await browser.storage.local.set({
			[key]: {
				volume: state.volume,
				muted: state.muted,
				prevVolume: state.prevVolume
			}
		});
	}

	async function saveSettings() {
		await browser.storage.local.set({
			vc_displayMode: state.displayMode,
			vc_accentColor: state.accentColor
		});
	}

	// ======== ОБРАБОТЧИКИ ========
	let debounceTimer;

	slider.addEventListener('input', async () => {
		state.volume = parseInt(slider.value);
		if (state.muted && state.volume > 0) {
			state.muted = false;
		}
		updateUI();

		clearTimeout(debounceTimer);
		debounceTimer = setTimeout(async () => {
			await applyVolume();
			await saveTabVolume();
		}, 25);
	});

	muteBtn.addEventListener('click', async () => {
		if (state.muted) {
			state.muted = false;
			state.volume = state.prevVolume || 100;
		} else {
			state.prevVolume = state.volume;
			state.muted = true;
		}
		updateUI();
		await applyVolume();
		await saveTabVolume();
	});

	resetBtn.addEventListener('click', async () => {
		state.muted = false;
		state.volume = 100;
		updateUI();
		await applyVolume();
		await saveTabVolume();
	});

	presets.forEach(p => {
		p.addEventListener('click', async () => {
			state.volume = parseInt(p.dataset.value);
			state.muted = false;
			updateUI();
			await applyVolume();
			await saveTabVolume();
		});
	});

	settingsBtn.addEventListener('click', () => {
		settingsPanel.classList.toggle('open');
	});

	modeOptions.forEach(m => {
		m.addEventListener('click', async () => {
			state.displayMode = m.dataset.mode;
			updateUI();
			await saveSettings();
		});
	});

	if (colorSwatch) {
		colorSwatch.addEventListener('click', async () => {
			state.accentColor = '#eaeaea';
			applyAccentColor(state.accentColor);
			await saveSettings();
		});
	}

	if (colorValue) {
    	colorValue.addEventListener('input', async () => {
    	    let color = colorValue.value.trim();

    	    if (color.match(/^[0-9a-fA-F]{6}$/)) {
    	        color = '#' + color;
    	    }

    	    const hexRegex = /^#([0-9a-fA-F]{6})$/;
    	    if (!hexRegex.test(color)) {
    	        return;
    	    }

    	    state.accentColor = color;
    	    applyAccentColor(state.accentColor);
    	    await saveSettings();
    	});

    	colorValue.addEventListener('blur', () => {
    	    let color = colorValue.value.trim();

    	    if (color.match(/^[0-9a-fA-F]{6}$/)) {
    	        color = '#' + color;
    	    }

    	    const hexRegex = /^#([0-9a-fA-F]{6})$/;
    	    if (hexRegex.test(color)) {
    	        colorValue.value = color.toUpperCase();
    	    } else {
    	        colorValue.value = state.accentColor.toUpperCase();
    	    }
    	});
	}

	browser.tabs.onRemoved.addListener(async (tabId) => {
		await browser.storage.local.remove(`vc_tab_${tabId}`);
	});

	// ======== ИНИЦИАЛИЗАЦИЯ ========
	await loadTabVolume();
	updateUI();
	await applyVolume();

})();
