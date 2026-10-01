"use strict";

const CARD_COUNT = 8;
const SPLIT_DELAY = 540;
const COMPLETION_SWEEP_MS = 780;
const INSTANT_DELAY_MAX = 4;
const INSTANT_BATCH_MS = 8;   
const SOUND_MIN_GAP = 30;    
let visualizerChartWidth = 0;
let lastVisualizerSoundAt = 0;

function createMergePlan(values) {
	const steps = [];

	function merge(left, right) {
		const result = [];
		let leftPosition = 0;
		let rightPosition = 0;
		while (leftPosition < left.length && rightPosition < right.length) {
			if (left[leftPosition] <= right[rightPosition]) result.push(left[leftPosition++]);
			else result.push(right[rightPosition++]);
		}
		return result.concat(left.slice(leftPosition), right.slice(rightPosition));
	}

	function divide(items, start = 0) {
		if (items.length <= 1) return items;
		const middle = Math.ceil(items.length / 2);
		const left = divide(items.slice(0, middle), start);
		const right = divide(items.slice(middle), start + middle);
		const merged = merge(left, right);
		steps.push({ start, middle: start + middle, end: start + items.length, left: [...left], right: [...right], merged: [...merged], output: [] });
		return merged;
	}

	const sorted = divide([...values]);
	return { steps, sorted };
}

function createSplitLevels(values) {
	const levels = [];
	let current = [[...values]];
	while (true) {
		levels.push(current);
		if (current.every((group) => group.length <= 1)) break;
		current = current.flatMap((group) => {
			if (group.length <= 1) return [group];
			const middle = Math.ceil(group.length / 2);
			return [group.slice(0, middle), group.slice(middle)];
		});
	}
	return levels;
}

function createRound(count = CARD_COUNT, valueRange = 30) {
	const pool = Array.from({ length: valueRange }, (_, index) => index + 1);
	for (let index = pool.length - 1; index > 0; index -= 1) {
		const swapIndex = Math.floor(Math.random() * (index + 1));
		[pool[index], pool[swapIndex]] = [pool[swapIndex], pool[index]];
	}
	const values = pool.slice(0, count);
	return { values, ...createMergePlan(values) };
}

function createVisualizerFrames(values, steps) {
	const frames = [];
	let groups = [{ values: [...values], start: 0, end: values.length }];
	while (groups.some((group) => group.values.length > 1)) {
		groups = groups.flatMap((group) => {
			if (group.values.length <= 1) return [group];
			const middle = Math.ceil(group.values.length / 2);
			return [
				{ values: group.values.slice(0, middle), start: group.start, end: group.start + middle },
				{ values: group.values.slice(middle), start: group.start + middle, end: group.end }
			];
		});
		frames.push({ type: "split", groups: groups.map((group) => ({ ...group })) });
	}

	for (const step of steps) {
		const leftIndex = groups.findIndex((group) => group.start === step.start && group.end === step.middle);
		if (leftIndex < 0 || groups[leftIndex + 1]?.start !== step.middle) continue;
		const leftValues = [...groups[leftIndex].values];
		const rightValues = [...groups[leftIndex + 1].values];
		let leftPosition = 0;
		let rightPosition = 0;
		const output = [];
		const displayGroups = (nextLeft = leftPosition, nextRight = rightPosition, merged = output) => {
			const partial = [];
			if (nextLeft < leftValues.length) partial.push({ values: leftValues.slice(nextLeft), role: "source" });
			if (nextRight < rightValues.length) partial.push({ values: rightValues.slice(nextRight), role: "source" });
			if (merged.length) partial.push({ values: [...merged], role: "output" });
			return [
				...groups.slice(0, leftIndex),
				...partial,
				...groups.slice(leftIndex + 2)
			].map((group) => ({ ...group, values: [...group.values] }));
		};

		while (leftPosition < leftValues.length && rightPosition < rightValues.length) {
			const compared = [leftValues[leftPosition], rightValues[rightPosition]];
			const chosenFromLeft = compared[0] <= compared[1];
			frames.push({ type: "compare", groups: displayGroups(), compareValues: compared });
			const movingValue = chosenFromLeft ? leftValues[leftPosition++] : rightValues[rightPosition++];
			output.push(movingValue);
			frames.push({ type: "move", groups: displayGroups(), movingValue });
		}
		while (leftPosition < leftValues.length || rightPosition < rightValues.length) {
			const movingValue = leftPosition < leftValues.length ? leftValues[leftPosition++] : rightValues[rightPosition++];
			output.push(movingValue);
			frames.push({ type: "move", groups: displayGroups(), movingValue });
		}

		groups.splice(leftIndex, 2, { values: [...step.merged], start: step.start, end: step.end, role: "merged" });
		frames.push({ type: "merge", groups: groups.map((group) => ({ ...group, values: [...group.values] })) });
	}
	return frames;
}

function createQuickSortFrames(values) {
	const frames = [];
	const items = [...values];

	function record(type, low, high, details = {}) {
		const groups = [];
		if (low > 0) groups.push({ values: items.slice(0, low) });
		groups.push({ values: items.slice(low, high + 1), role: "source" });
		if (high + 1 < items.length) groups.push({ values: items.slice(high + 1) });
		frames.push({ type, groups, ...details });
	}

	function partition(low, high) {
		const pivot = items[high];
		record("partition", low, high, { pivotValue: pivot });
		let boundary = low;
		for (let scan = low; scan < high; scan += 1) {
			const scannedValue = items[scan];
			record("compare", low, high, { compareValues: [scannedValue, pivot], pivotValue: pivot });
			if (scannedValue <= pivot) {
				if (boundary !== scan) {
					[items[boundary], items[scan]] = [items[scan], items[boundary]];
					record("move", low, high, { movingValues: [items[boundary], items[scan]], pivotValue: pivot });
				}
				boundary += 1;
			}
		}
		[items[boundary], items[high]] = [items[high], items[boundary]];
		record("pivot", low, high, { pivotValue: pivot, pivotIndex: boundary });
		return boundary;
	}

	function sort(low, high) {
		if (low >= high) return;
		const pivotIndex = partition(low, high);
		sort(low, pivotIndex - 1);
		sort(pivotIndex + 1, high);
	}

	sort(0, items.length - 1);
	return frames;
}

function cacheVisualizerFrame(frame, count) {
	const positions = new Uint16Array(count);
	const groupIndexes = new Uint16Array(count);
	const groupRoles = new Uint8Array(count);
	let cursor = 0;
	frame.groupCount = frame.groups.length;
	for (let groupIndex = 0; groupIndex < frame.groups.length; groupIndex += 1) {
		const group = frame.groups[groupIndex];
		for (const value of group.values) {
			const valueIndex = value - 1;
			positions[valueIndex] = cursor++;
			groupIndexes[valueIndex] = groupIndex;
			groupRoles[valueIndex] = group.role === "output" || group.role === "merged" ? 1 : 0;
		}
	}
	frame.positions = positions;
	frame.groupIndexes = groupIndexes;
	frame.groupRoles = groupRoles;
	delete frame.groups;
	return frame;
}

const elements = {
	app: document.querySelector(".app-shell"),
	board: document.querySelector("#board"),
	boardWrap: document.querySelector("#board-wrap"),
	score: document.querySelector("#score"),
	combo: document.querySelector("#combo"),
	progress: document.querySelector("#progress"),
	progressBar: document.querySelector("#progress-bar"),
	stageIcon: document.querySelector("#stage-icon"),
	stageKicker: document.querySelector("#stage-kicker"),
	stageTitle: document.querySelector("#stage-title"),
	hint: document.querySelector("#hint"),
	action: document.querySelector("#action-button"),
	restart: document.querySelector("#restart"),
	sound: document.querySelector("#sound-toggle"),
	soundLabel: document.querySelector("#sound-label"),
	introText: document.querySelector("#intro-text"),
	modeTabs: [...document.querySelectorAll(".mode-tab")],
	algorithmOptions: [...document.querySelectorAll(".algorithm-option")],
	algorithmFacts: document.querySelector("#algorithm-facts"),
	visualizerControls: document.querySelector("#visualizer-controls"),
	barCount: document.querySelector("#bar-count"),
	barCountValue: document.querySelector("#bar-count-value"),
	gameBarCount: document.querySelector("#game-bar-count"),
	gameBarCountValue: document.querySelector("#game-bar-count-value"),
	gameAlgorithmOptions: [...document.querySelectorAll(".game-algorithm-option")],
	animationSpeed: document.querySelector("#animation-speed"),
	speedValue: document.querySelector("#speed-value"),
	visualizerPlay: document.querySelector("#visualizer-play"),
	visualizerStep: document.querySelector("#visualizer-step"),
	shuffleArray: document.querySelector("#shuffle-array"),
	restartVisualizer: document.querySelector("#restart-visualizer"),
	visualizerStatus: document.querySelector("#visualizer-status")
};

let round;
let phase;
let gameAlgorithm = "merge";
let quickGameValues = [];
let quickGameRanges = [];
let quickGamePartition;
let quickGameComparisons = 0;
let quickGameComparisonTotal = 0;
let quickGameTimer;
let splitLevels;
let splitIndex;
let stepIndex;
let leftIndex;
let rightIndex;
let score;
let combo;
let soundEnabled = true;
let audioContext;
let splitTimer;
let currentMode = "game";
let visualizerRound;
let visualizerFrames = [];
let visualizerInitialFrame;
let visualizerFrameIndex = 0;
let quickSortFrames = [];
let quickSortInitialFrame;
let quickSortFrameIndex = 0;
let quickSortBarNodes = new Map();
let visualizerAlgorithm = "merge";
let visualizerTimer;
let visualizerTimerKind = "timeout";
const immediatePlaybackTasks = new Map();
const immediatePlaybackChannel = typeof MessageChannel === "function" ? new MessageChannel() : null;
let nextImmediatePlaybackTask = 0;
if (immediatePlaybackChannel) {
	immediatePlaybackChannel.port1.onmessage = ({ data: taskId }) => {
		const task = immediatePlaybackTasks.get(taskId);
		if (!task) return;
		immediatePlaybackTasks.delete(taskId);
		task();
	};
}
let resizeFrame;
let visualizerPlaying = false;
let visualizerBarCount = 32;
let visualizerPlaybackId = 0;
let visualizerBarNodes = new Map();
let gameBarCount = CARD_COUNT;
let visualizerCompletionPlayed = false;
let visualizerCompletionPending = false;
let visualizerCompletionTimer;
let gameCompletionPlayed = false;
let visualizerSweepSoundTimer;
let gameSweepSoundTimer;

function setHint(message, type = "") {
	elements.hint.className = `hint ${type}`;
	elements.hint.innerHTML = `<span class="hint-bullet"></span><span>${message}</span>`;
}

function setStage(kicker, title, icon) {
	elements.stageKicker.textContent = kicker;
	elements.stageTitle.textContent = title;
	elements.stageIcon.textContent = icon;
}

function updateStats() {
	elements.score.textContent = String(score).padStart(4, "0");
	elements.combo.textContent = String(combo);
	if (gameAlgorithm === "quick") {
		const completed = phase === "complete" ? quickGameComparisonTotal : quickGameComparisons;
		elements.progress.innerHTML = `${completed}<span class="stat-total"> / ${quickGameComparisonTotal}</span>`;
		elements.progressBar.style.width = `${(completed / quickGameComparisonTotal) * 100}%`;
		return;
	}
	const totalMoves = round.steps.reduce((sum, step) => sum + step.left.length + step.right.length, 0);
	const completed = phase === "complete" ? totalMoves : round.steps.slice(0, stepIndex).reduce((sum, step) => sum + step.output.length, 0);
	const current = phase === "merge" && round.steps[stepIndex] ? round.steps[stepIndex].output.length : 0;
	const done = completed + current;
	elements.progress.innerHTML = `${done}<span class="stat-total"> / ${totalMoves}</span>`;
	elements.progressBar.style.width = `${(done / totalMoves) * 100}%`;
}

function bar(value, className = "", label = "", tagName = "div", maxValue = 30, heightScale = 51) {
	const item = document.createElement(tagName);
	item.className = `bar-item ${className}`.trim();
	item.dataset.value = String(value);
	item.style.setProperty("--bar-height", `${18 + (value / maxValue) * heightScale}px`);
	item.style.setProperty("--bar-hue", String((value * 47) % 360));
	if (label) item.setAttribute("aria-label", label);
	const fill = document.createElement("span");
	fill.className = "bar-fill";
	fill.setAttribute("aria-hidden", "true");
	const number = document.createElement("span");
	number.className = "bar-value";
	number.textContent = String(value).padStart(2, "0");
	item.append(fill, number);
	return item;
}

function playCompletionSweep(bars, duration = COMPLETION_SWEEP_MS, playDings = true) {
	const lastIndex = Math.max(1, bars.length - 1);
	const spacing = duration / lastIndex;
	const toneDuration = Math.min(0.085, Math.max(0.01, spacing * 0.75));
	const toneVolume = Math.max(0.008, 0.04 * Math.sqrt(8 / Math.max(1, bars.length)));
	const dingTimers = [];
	for (let index = 0; index < bars.length; index += 1) {
		const delay = (index / lastIndex) * duration;
		bars[index].style.setProperty("--sweep-delay", `${delay}ms`);
		bars[index].classList.add("completion-sweep");
		if (playDings) {
			const pitch = 740 + (index / lastIndex) * 640;
			dingTimers.push(setTimeout(() => playTone(pitch, toneDuration, "sine", toneVolume), delay));
		}
	}
	const jingleVolume = Math.min(0.04, toneVolume * 1.2);
	dingTimers.push(setTimeout(() => {
		playTone(1480, 0.095, "sine", jingleVolume);
		dingTimers.push(setTimeout(() => playTone(1760, 0.14, "sine", jingleVolume * 0.78), 65));
	}, duration + toneDuration));
	return dingTimers;
}

function clearCompletionDings(dingTimers) {
	for (const timer of dingTimers || []) clearTimeout(timer);
}

function renderIntro() {
	elements.board.className = "board intro-board";
	elements.board.replaceChildren();
	const pile = document.createElement("div");
	pile.className = "card-row intro-cards";
	round.values.forEach((value, index) => {
		const item = bar(value, "deal-bar", "", "div", gameBarCount);
		item.style.setProperty("--deal-index", index);
		pile.append(item);
	});
	const note = document.createElement("p");
	note.className = "board-caption";
	note.textContent = "YOUR UNSORTED SEQUENCE";
	elements.board.append(pile, note);
}

function renderSplit() {
	elements.board.className = "board split-board";
	elements.board.replaceChildren();
	const groups = splitLevels[splitIndex] || [];
	const groupRow = document.createElement("div");
	groupRow.className = "split-groups";
	groups.forEach((group, groupIndex) => {
		const lane = document.createElement("div");
		lane.className = "split-group";
		lane.style.setProperty("--group-index", groupIndex);
		group.forEach((value) => lane.append(bar(value, "split-bar", "", "div", gameBarCount)));
		groupRow.append(lane);
	});
	const caption = document.createElement("p");
	caption.className = "board-caption";
	caption.textContent = `SPLIT ${splitIndex} / ${splitLevels.length - 1} · HALVING THE ARRAY`;
	elements.board.append(groupRow, caption);
}

function makeRun(title, values, index, activeIndex) {
	const run = document.createElement("section");
	run.className = "run-column";
	const heading = document.createElement("div");
	heading.className = "run-heading";
	heading.innerHTML = `<span>${title}</span><span class="run-count">${Math.max(0, values.length - index)} LEFT</span>`;
	const cards = document.createElement("div");
	cards.className = "run-cards";
	values.forEach((value, cardIndex) => {
		const isUsed = cardIndex < index;
		const isHead = cardIndex === activeIndex;
		const button = bar(value, `choice-bar${isUsed ? " used-bar" : ""}${isHead ? " head-bar" : ""}`, `Choose ${value} from ${title}${isHead ? ", available next" : ""}`, "button", gameBarCount);
		button.type = "button";
		button.disabled = isUsed;
		button.addEventListener("click", () => choose(value, title));
		cards.append(button);
	});
	run.append(heading, cards);
	return run;
}

function renderMerge() {
	elements.board.className = "board merge-board";
	elements.board.replaceChildren();
	const step = round.steps[stepIndex];
	const expected = Math.min(step.left[leftIndex] ?? Infinity, step.right[rightIndex] ?? Infinity);
	const columns = document.createElement("div");
	columns.className = "merge-columns";
	columns.append(
		makeRun("LEFT RUN", step.left, leftIndex, step.left[leftIndex] === expected ? leftIndex : -1),
		makeRun("RIGHT RUN", step.right, rightIndex, step.right[rightIndex] === expected ? rightIndex : -1)
	);
	const arrow = document.createElement("div");
	arrow.className = "merge-arrow";
	arrow.setAttribute("aria-hidden", "true");
	arrow.textContent = "↓";
	const output = document.createElement("section");
	output.className = "output-run";
	const outputHeading = document.createElement("div");
	outputHeading.className = "run-heading";
	outputHeading.innerHTML = `<span>MERGED ROW</span><span class="run-count">${step.output.length} / ${step.left.length + step.right.length}</span>`;
	const outputCards = document.createElement("div");
	outputCards.className = "output-cards";
	step.output.forEach((value) => outputCards.append(bar(value, "output-bar", "", "div", gameBarCount)));
	if (!step.output.length) outputCards.classList.add("empty-output");
	output.append(outputHeading, outputCards);
	elements.board.append(columns, arrow, output);
}

function renderQuickGame(animate = true) {
	const previousPositions = new Map([...elements.board.querySelectorAll(".quick-game-bar")].map((item) => [
		Number(item.dataset.value), item.getBoundingClientRect()
	]));
	elements.board.className = `board quick-game-board${gameBarCount > 32 ? " dense-bars" : ""}`;
	elements.board.replaceChildren();
	const row = document.createElement("div");
	row.className = "card-row quick-game-row";
	quickGameValues.forEach((value, index) => {
		const partition = quickGamePartition;
		const inRange = partition && index >= partition.low && index <= partition.high;
		const isPivot = partition && (partition.pivotPlaced ? index === partition.pivotIndex : index === partition.high);
		const isActive = partition && !partition.pivotPlaced && index === partition.scan;
		const className = `quick-game-bar choice-bar${inRange ? " in-partition" : " outside-partition"}${isPivot ? " quick-pivot-bar" : ""}${isActive ? " quick-scan-bar head-bar" : ""}`;
		const item = bar(value, className, `Bar ${value}${isPivot ? ", pivot" : ""}${isActive ? ", next to compare" : ""}`, "button", gameBarCount);
		item.type = "button";
		item.disabled = !isActive || phase !== "quick";
		if (isActive) item.addEventListener("click", () => chooseQuickScan(index));
		row.append(item);
	});
	const instruction = document.createElement("p");
	instruction.className = "board-caption quick-caption";
	instruction.textContent = quickGamePartition
		? quickGamePartition.pivotPlaced
			? `PIVOT ${quickGamePartition.pivotValue} PLACED`
			: `PARTITION ${quickGamePartition.low + 1}–${quickGamePartition.high + 1} · PIVOT ${quickGamePartition.pivotValue}`
		: "QUICK SORT COMPLETE";
	elements.board.append(row, instruction);
	if (!animate) return;
	const movedBars = [...row.querySelectorAll(".quick-game-bar")];
	for (const item of movedBars) {
		const previous = previousPositions.get(Number(item.dataset.value));
		if (!previous) continue;
		const current = item.getBoundingClientRect();
		item.style.transition = "none";
		item.style.transform = `translate(${previous.left - current.left}px, ${previous.top - current.top}px)`;
	}
	void row.offsetWidth;
	requestAnimationFrame(() => {
		for (const item of movedBars) {
			item.style.transition = "transform 280ms var(--ease)";
			item.style.transform = "translate(0, 0)";
		}
	});
}

function beginQuickPartition() {
	while (quickGameRanges.length) {
		const range = quickGameRanges.pop();
		if (range.high - range.low < 1) continue;
		quickGamePartition = {
			...range,
			pivotValue: quickGameValues[range.high],
			boundary: range.low,
			scan: range.low,
			pivotPlaced: false
		};
		setStage("QUICK SORT / PARTITION", `Compare with pivot ${quickGamePartition.pivotValue}`, "02");
		setHint(`Select the highlighted bar. Values smaller than the pivot move left.`);
		renderQuickGame(false);
		return;
	}
	quickGamePartition = undefined;
	finishGame(true, quickGameValues, "Array sorted", "QUICK SORT COMPLETE");
}

function startQuickGame() {
	phase = "quick";
	quickGameValues = [...round.values];
	quickGameRanges = [{ low: 0, high: quickGameValues.length - 1 }];
	quickGamePartition = undefined;
	quickGameComparisons = 0;
	quickGameComparisonTotal = createQuickSortFrames(quickGameValues).filter((frame) => frame.type === "compare").length;
	elements.action.disabled = true;
	elements.action.innerHTML = "<span>Choose the highlighted bar</span>";
	beginQuickPartition();
	updateStats();
}

function chooseQuickScan(index) {
	if (phase !== "quick" || !quickGamePartition || quickGamePartition.pivotPlaced || index !== quickGamePartition.scan) return;
	const partition = quickGamePartition;
	const value = quickGameValues[index];
	quickGameComparisons += 1;
	combo += 1;
	score += 100 + Math.max(0, combo - 1) * 25;
	playTone(340 + Math.min(value, 64) * 3, 0.07, "sine", 0.035);
	if (value <= partition.pivotValue) {
		if (partition.boundary !== index) {
			[quickGameValues[partition.boundary], quickGameValues[index]] = [quickGameValues[index], quickGameValues[partition.boundary]];
			playTone(500 + Math.min(value, 64) * 2, 0.08, "triangle", 0.03);
		}
		partition.boundary += 1;
	}
	partition.scan += 1;
	updateStats();
	if (partition.scan < partition.high) {
		setHint(value <= partition.pivotValue ? `${value} is at or below the pivot. Keep scanning.` : `${value} is above the pivot. Keep scanning.` , "hint-good");
		renderQuickGame();
		return;
	}
	[quickGameValues[partition.boundary], quickGameValues[partition.high]] = [quickGameValues[partition.high], quickGameValues[partition.boundary]];
	partition.pivotIndex = partition.boundary;
	partition.pivotPlaced = true;
	playTone(760, 0.12, "sine", 0.04);
	setHint(`Pivot ${partition.pivotValue} is in place.`, "hint-good");
	renderQuickGame();
	quickGameTimer = setTimeout(() => {
		quickGameTimer = undefined;
		if (phase !== "quick" || !quickGamePartition?.pivotPlaced || currentMode !== "game") return;
		advanceQuickRanges();
	}, 280);
}

function advanceQuickRanges() {
	const { low, high, pivotIndex } = quickGamePartition;
	if (pivotIndex + 1 < high) quickGameRanges.push({ low: pivotIndex + 1, high });
	if (low < pivotIndex - 1) quickGameRanges.push({ low, high: pivotIndex - 1 });
	quickGamePartition = undefined;
	beginQuickPartition();
	updateStats();
}

function prepareVisualizer(values = createRound(visualizerBarCount, visualizerBarCount).values) {
	for (const item of visualizerBarNodes.values()) item.getAnimations().forEach((animation) => animation.cancel());
	pauseVisualizer();
	const countChanged = visualizerRound && visualizerRound.values.length !== values.length;
	visualizerRound = { values, ...createMergePlan(values) };
	visualizerFrames = createVisualizerFrames(values, visualizerRound.steps).map((frame) => cacheVisualizerFrame(frame, values.length));
	visualizerInitialFrame = cacheVisualizerFrame({ type: "initial", groups: [{ values: [...values] }] }, values.length);
	quickSortFrames = createQuickSortFrames(values).map((frame) => cacheVisualizerFrame(frame, values.length));
	quickSortInitialFrame = cacheVisualizerFrame({ type: "initial", groups: [{ values: [...values] }] }, values.length);
	visualizerFrameIndex = 0;
	quickSortFrameIndex = 0;
	visualizerCompletionPlayed = false;
	visualizerCompletionPending = false;
	clearTimeout(visualizerCompletionTimer);
	visualizerCompletionTimer = undefined;
	if (countChanged) {
		visualizerBarNodes = new Map();
		quickSortBarNodes = new Map();
	}
	if (countChanged && currentMode === "visualizer") elements.board.replaceChildren();
	renderAlgorithmFacts();
	elements.visualizerStatus.textContent = getVisualizerReadyStatus(values.length);
	if (currentMode === "visualizer") {
		setStage("VISUALIZER / READY", getVisualizerReadyStatus(values.length), "V");
		elements.progressBar.style.width = "0%";
		renderVisualizer(false);
		if (areActiveVisualizersComplete()) scheduleVisualizerCompletion();
	}
	updateVisualizerControls();
}

function renderVisualizerLane(chart, algorithm, animate) {
	const isQuick = algorithm === "quick";
	const frames = isQuick ? quickSortFrames : visualizerFrames;
	const frameIndex = isQuick ? quickSortFrameIndex : visualizerFrameIndex;
	const initialFrame = isQuick ? quickSortInitialFrame : visualizerInitialFrame;
	let barNodes = isQuick ? quickSortBarNodes : visualizerBarNodes;
	const frame = frames[frameIndex - 1];
	const state = frame || initialFrame;
	const count = visualizerRound.values.length;
	if (barNodes.size !== count) {
		chart.replaceChildren();
		barNodes = new Map();
		for (const value of visualizerRound.values) {
			const item = bar(value, "visual-bar", `Bar value ${value}`, "div", count, 162);
			barNodes.set(value, item);
			chart.append(item);
		}
	} else if (chart.children.length !== count) {
		chart.replaceChildren(...barNodes.values());
	}
	if (isQuick) quickSortBarNodes = barNodes;
	else visualizerBarNodes = barNodes;

	const availableWidth = Math.max(140, chart.clientWidth);
	const preferredWidth = count <= 8 ? 52 : count <= 16 ? 36 : count <= 32 ? 20 : count <= 64 ? 10 : count <= 128 ? 4 : 1.5;
	const requestedBarGap = count <= 16 ? 5 : count <= 32 ? 3 : count <= 64 ? 1.5 : count <= 128 ? 0.75 : 0.25;
	const requestedGroupGap = count <= 16 ? 14 : count <= 32 ? 8 : count <= 64 ? 4 : count <= 128 ? 2 : 0.75;
	const desiredWidth = count * preferredWidth + (count - state.groupCount) * requestedBarGap + (state.groupCount - 1) * requestedGroupGap;
	const scale = Math.min(1, availableWidth / desiredWidth);
	const barWidth = preferredWidth * scale;
	const barGap = requestedBarGap * scale;
	const groupGap = requestedGroupGap * scale;
	const totalWidth = count * barWidth + (count - state.groupCount) * barGap + (state.groupCount - 1) * groupGap;
	const offset = Math.max(0, (availableWidth - totalWidth) / 2);
	chart.style.setProperty("--visual-duration", animate ? `${Number(elements.animationSpeed.value) * 0.78}ms` : "0ms");
	for (let value = 1; value <= count; value += 1) {
		const index = value - 1;
		const item = barNodes.get(value);
		const isCompared = frame?.type === "compare" && frame.compareValues.includes(value);
		const isMoving = frame?.type === "move" && (frame.movingValue === value || frame.movingValues?.includes(value));
		const isPivot = frame?.pivotValue === value;
		item.className = `bar-item visual-bar${state.groupRoles[index] ? " sorted-bar" : ""}${isCompared ? " compare-bar" : ""}${isMoving ? " moving-bar" : ""}${isPivot ? " pivot-bar" : ""}`;
		item.setAttribute("aria-label", `Bar value ${value}${isCompared ? ", comparing" : isMoving ? ", moving" : isPivot ? ", pivot" : ""}`);
		item.style.width = `${barWidth}px`;
		item.style.setProperty("--bar-height", `${18 + (value / count) * 162}px`);
		const x = offset + state.positions[index] * (barWidth + barGap) + state.groupIndexes[index] * (groupGap - barGap);
		item.style.setProperty("--visual-x", `${x}px`);
	}
}

function createComparisonLane(title, algorithm) {
	const lane = document.createElement("section");
	lane.className = `comparison-lane ${algorithm}-comparison`;
	const heading = document.createElement("h3");
	heading.className = "comparison-title";
	heading.textContent = title;
	const chart = document.createElement("div");
	chart.className = "visual-groups";
	lane.append(heading, chart);
	return lane;
}

function renderVisualizer(animate = true) {
	elements.board.className = `board visualizer-board${visualizerBarCount > 32 ? " dense-bars" : ""}${visualizerAlgorithm === "compare" ? " compare-board" : ""}`;
	if (visualizerAlgorithm === "compare") {
		let layout = elements.board.querySelector(".comparison-layout");
		if (!layout) {
			elements.board.replaceChildren();
			layout = document.createElement("div");
			layout.className = "comparison-layout";
			layout.append(createComparisonLane("Merge Sort", "merge"), createComparisonLane("Quick Sort", "quick"));
			elements.board.append(layout);
		}
		renderVisualizerLane(layout.querySelector(".merge-comparison .visual-groups"), "merge", animate);
		renderVisualizerLane(layout.querySelector(".quick-comparison .visual-groups"), "quick", animate);
		return;
	}
	let chart = elements.board.querySelector(".visual-groups");
	if (!chart || chart.closest(".comparison-layout")) {
		elements.board.replaceChildren();
		chart = document.createElement("div");
		chart.className = "visual-groups";
		elements.board.append(chart);
	}
	renderVisualizerLane(chart, visualizerAlgorithm, animate);
}

function updateVisualizerControls() {
	const playText = elements.visualizerPlay.querySelector("span");
	const complete = areActiveVisualizersComplete();
	playText.textContent = visualizerPlaying ? "Pause" : complete ? "Replay" : "Start";
	elements.visualizerPlay.setAttribute("aria-label", playText.textContent);
	elements.visualizerPlay.classList.toggle("is-playing", visualizerPlaying);
	elements.visualizerStep.disabled = complete;
	elements.visualizerStatus.classList.toggle("is-playing", visualizerPlaying);
}

function getVisualizerReadyStatus(count = visualizerRound.values.length) {
	if (visualizerAlgorithm === "compare") return `${count} bars · Merge ${visualizerFrames.length} steps · Quick ${quickSortFrames.length} steps`;
	const frames = visualizerAlgorithm === "quick" ? quickSortFrames : visualizerFrames;
	return `${count} bars · ${frames.length} steps`;
}

function getActiveVisualizerAlgorithms() {
	return visualizerAlgorithm === "compare" ? ["merge", "quick"] : [visualizerAlgorithm];
}

function getVisualizerFrames(algorithm) {
	return algorithm === "quick" ? quickSortFrames : visualizerFrames;
}

function getVisualizerFrameIndex(algorithm) {
	return algorithm === "quick" ? quickSortFrameIndex : visualizerFrameIndex;
}

function setVisualizerFrameIndex(algorithm, index) {
	if (algorithm === "quick") quickSortFrameIndex = index;
	else visualizerFrameIndex = index;
}

function areActiveVisualizersComplete() {
	return getActiveVisualizerAlgorithms().every((algorithm) => getVisualizerFrameIndex(algorithm) >= getVisualizerFrames(algorithm).length);
}

function getVisualizerProgress() {
	const algorithms = getActiveVisualizerAlgorithms();
	return algorithms.reduce((total, algorithm) => total + getVisualizerFrameIndex(algorithm) / getVisualizerFrames(algorithm).length, 0) / algorithms.length;
}

function playVisualizerSound(frame, algorithm) {
	if (!soundEnabled) return;
	if (frame.type === "split") {
		playTone(190 + Math.min(frame.groupCount, 8) * 18, 0.075, "triangle", 0.035);
	} else if (frame.type === "compare") {
		playTone(340 + Math.min(frame.compareValues[0], 128) * 1.4, 0.045, "sine", 0.025);
	} else if (frame.type === "move") {
		const movedValue = frame.movingValue ?? frame.movingValues?.[0] ?? 1;
		playTone(430 + Math.min(movedValue, 128) * 1.8, 0.065, "sine", 0.035);
	} else if (frame.type === "merge") {
		playTone(600, 0.13, "sine", 0.045);
		playTone(790, 0.17, "sine", 0.025);
	} else if (frame.type === "partition") {
		playTone(260 + Math.min(frame.pivotValue, 128), 0.07, "triangle", 0.028);
	} else if (frame.type === "pivot") {
		playTone(700 + Math.min(frame.pivotValue, 128), 0.1, "sine", 0.035);
	}
}

function advanceVisualizer() {
	const advanced = [];
	for (const algorithm of getActiveVisualizerAlgorithms()) {
		const frames = getVisualizerFrames(algorithm);
		const frameIndex = getVisualizerFrameIndex(algorithm);
		if (frameIndex >= frames.length) continue;
		advanced.push({ algorithm, frame: frames[frameIndex], index: frameIndex + 1 });
		setVisualizerFrameIndex(algorithm, frameIndex + 1);
	}
	if (!advanced.length) return false;
	renderVisualizer();
	for (const item of advanced) playVisualizerSound(item.frame, item.algorithm);
	elements.progressBar.style.width = `${getVisualizerProgress() * 100}%`;
	const complete = areActiveVisualizersComplete();
	if (visualizerAlgorithm === "compare") {
		setStage(complete ? "VISUALIZER / COMPLETE" : "VISUALIZER / COMPARE", complete ? "Both arrays sorted" : "Compare partition behavior", complete ? "03" : "02");
		elements.visualizerStatus.textContent = complete
			? `Both sorted · ${visualizerFrames.length} Merge steps · ${quickSortFrames.length} Quick steps`
			: `Merge ${visualizerFrameIndex}/${visualizerFrames.length} · Quick ${quickSortFrameIndex}/${quickSortFrames.length}`;
	} else {
		const current = advanced[0].frame;
		const title = current.type === "compare" ? "Compare the run heads" : current.type === "move" ? `Move ${current.movingValue ?? current.movingValues?.[0]} into order` : current.type === "pivot" ? `Pivot ${current.pivotValue} placed` : `${current.groupCount} ${current.groupCount === 1 ? "run" : "runs"}`;
		const status = current.type === "compare" ? "Comparing" : current.type === "move" ? "Moving" : current.type === "pivot" ? "Pivot placed" : current.type === "partition" ? "Partitioning" : current.type === "split" ? "Splitting" : "Merging";
		setStage(complete ? "VISUALIZER / COMPLETE" : `VISUALIZER / ${current.type.toUpperCase()}`, complete ? "Array sorted" : title, complete ? "03" : current.type === "split" || current.type === "partition" ? "01" : current.type === "merge" || current.type === "pivot" ? "03" : "02");
		elements.visualizerStatus.textContent = complete
			? `${visualizerRound.values.length} bars sorted · ${getVisualizerFrames(visualizerAlgorithm).length} steps`
			: `${status} · ${getVisualizerFrameIndex(visualizerAlgorithm)} of ${getVisualizerFrames(visualizerAlgorithm).length}`;
	}
	if (complete) {
		visualizerPlaying = false;
		scheduleVisualizerCompletion();
	}
	updateVisualizerControls();
	return true;
}

function scheduleVisualizerCompletion() {
	if (visualizerCompletionPlayed || visualizerCompletionPending || currentMode !== "visualizer" || !areActiveVisualizersComplete()) return;
	visualizerCompletionPending = true;
	const playbackId = visualizerPlaybackId;
	const delay = Number(elements.animationSpeed.value) * 0.78;
	visualizerCompletionTimer = setTimeout(() => {
		visualizerCompletionPending = false;
		visualizerCompletionTimer = undefined;
		if (playbackId !== visualizerPlaybackId || currentMode !== "visualizer" || !areActiveVisualizersComplete()) return;
		visualizerCompletionPlayed = true;
		const sortedBars = (frames, nodes) => {
			const finalFrame = frames[frames.length - 1];
			return [...nodes.entries()]
				.sort(([firstValue], [secondValue]) => finalFrame.positions[firstValue - 1] - finalFrame.positions[secondValue - 1])
				.map(([, item]) => item);
		};
		if (visualizerAlgorithm === "compare") {
			visualizerSweepSoundTimer = [
				...playCompletionSweep(sortedBars(visualizerFrames, visualizerBarNodes)),
				...playCompletionSweep(sortedBars(quickSortFrames, quickSortBarNodes), COMPLETION_SWEEP_MS, false)
			];
		} else if (visualizerAlgorithm === "quick") {
			visualizerSweepSoundTimer = playCompletionSweep(sortedBars(quickSortFrames, quickSortBarNodes));
		} else {
			visualizerSweepSoundTimer = playCompletionSweep(sortedBars(visualizerFrames, visualizerBarNodes));
		}
	}, delay);
}

function pauseVisualizer() {
	visualizerPlaying = false;
	visualizerPlaybackId += 1;
	if (visualizerTimerKind === "task") immediatePlaybackTasks.delete(visualizerTimer);
	else clearTimeout(visualizerTimer);
	visualizerTimer = undefined;
	visualizerTimerKind = "timeout";
	clearTimeout(visualizerCompletionTimer);
	visualizerCompletionTimer = undefined;
	visualizerCompletionPending = false;
	clearCompletionDings(visualizerSweepSoundTimer);
	visualizerSweepSoundTimer = undefined;
	updateVisualizerControls();
}

function runVisualizer(playbackId) {
	if (!visualizerPlaying || playbackId !== visualizerPlaybackId) return;
	if (!advanceVisualizer()) {
		pauseVisualizer();
		return;
	}
	if (visualizerPlaying && playbackId === visualizerPlaybackId) {
		const delay = Number(elements.animationSpeed.value);
		if (delay === 0 && immediatePlaybackChannel) {
			visualizerTimerKind = "task";
			visualizerTimer = ++nextImmediatePlaybackTask;
			immediatePlaybackTasks.set(visualizerTimer, () => runVisualizer(playbackId));
			immediatePlaybackChannel.port2.postMessage(visualizerTimer);
		} else {
			visualizerTimerKind = "timeout";
			visualizerTimer = setTimeout(() => runVisualizer(playbackId), delay);
		}
	}
}

function toggleVisualizer() {
	if (visualizerPlaying) {
		pauseVisualizer();
		return;
	}
	if (areActiveVisualizersComplete()) restartVisualizer();
	visualizerPlaying = true;
	updateVisualizerControls();
	visualizerPlaybackId += 1;
	runVisualizer(visualizerPlaybackId);
}

function stepVisualizer() {
	if (visualizerPlaying) pauseVisualizer();
	advanceVisualizer();
}

function shuffleVisualizer() {
	prepareVisualizer(createRound(visualizerBarCount, visualizerBarCount).values);
}

function restartVisualizer() {
	const values = [...visualizerRound.values];
	prepareVisualizer(values);
}

function setVisualizerAlgorithm(algorithm) {
	if (algorithm === visualizerAlgorithm) return;
	pauseVisualizer();
	visualizerAlgorithm = algorithm;
	visualizerFrameIndex = 0;
	quickSortFrameIndex = 0;
	visualizerCompletionPlayed = false;
	visualizerCompletionPending = false;
	clearTimeout(visualizerCompletionTimer);
	visualizerCompletionTimer = undefined;
	for (const option of elements.algorithmOptions) {
		option.setAttribute("aria-pressed", String(option.dataset.algorithm === algorithm));
	}
	renderAlgorithmFacts();
	elements.progressBar.style.width = "0%";
	elements.visualizerStatus.textContent = getVisualizerReadyStatus();
	if (currentMode === "visualizer") {
		setStage("VISUALIZER / READY", getVisualizerReadyStatus(), "V");
		renderVisualizer(false);
	}
	updateVisualizerControls();
}

function renderAlgorithmFacts() {
	const facts = [
		{ algorithm: "merge", title: "Merge Sort", text: "Splits the array into smaller halves, sorts those halves, then merges them back together in order." },
		{ algorithm: "quick", title: "Quick Sort", text: "Picks a pivot, moves smaller values to one side and larger values to the other, then repeats on each side." }
	];
	const visibleFacts = visualizerAlgorithm === "compare" ? facts : facts.filter((fact) => fact.algorithm === visualizerAlgorithm);
	elements.algorithmFacts.classList.toggle("compare-facts", visibleFacts.length > 1);
	elements.algorithmFacts.replaceChildren(...visibleFacts.map((fact) => {
		const article = document.createElement("article");
		article.className = "algorithm-fact";
		const title = document.createElement("h3");
		title.textContent = `How ${fact.title} works`;
		const description = document.createElement("p");
		description.textContent = fact.text;
		article.append(title, description);
		return article;
	}));
}

function setGameAlgorithm(algorithm) {
	if (algorithm === gameAlgorithm) return;
	gameAlgorithm = algorithm;
	for (const option of elements.gameAlgorithmOptions) {
		option.setAttribute("aria-pressed", String(option.dataset.gameAlgorithm === algorithm));
	}
	resetGame();
}

function setMode(mode) {
	const previousMode = currentMode;
	if (mode !== previousMode) pauseVisualizer();
	currentMode = mode;
	const isVisualizer = mode === "visualizer";
	elements.app.classList.toggle("visualizer-mode", isVisualizer);
	elements.visualizerControls.hidden = !isVisualizer;
	for (const tab of elements.modeTabs) tab.setAttribute("aria-selected", String(tab.dataset.mode === mode));
	elements.introText.textContent = isVisualizer
		? "Watch every split and merge unfold. Set the scale, then step through the algorithm."
		: "Break it down. Build it back. Sort the chaos, one satisfying move at a time.";
	if (isVisualizer) {
		setStage("VISUALIZER / READY", getVisualizerReadyStatus(), "V");
		const hasProgress = getActiveVisualizerAlgorithms().some((algorithm) => getVisualizerFrameIndex(algorithm) > 0);
		if (hasProgress && !areActiveVisualizersComplete()) {
			setStage("VISUALIZER / PAUSED", getVisualizerReadyStatus(), "V");
		} else if (areActiveVisualizersComplete()) {
			setStage("VISUALIZER / COMPLETE", "Array sorted", "03");
		}
		renderVisualizer(false);
		if (areActiveVisualizersComplete()) scheduleVisualizerCompletion();
	} else if (previousMode === "visualizer") {
		for (const item of visualizerBarNodes.values()) item.getAnimations().forEach((animation) => animation.cancel());
	}
	if (!isVisualizer && phase === "ready") {
		setStage("READY WHEN YOU ARE", "Meet your numbers", "01");
		elements.action.disabled = false;
		elements.action.innerHTML = '<span>Start sorting</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6"></path></svg>';
		renderIntro();
	} else if (!isVisualizer && phase === "quick") {
		setStage("QUICK SORT / PARTITION", quickGamePartition?.pivotPlaced ? `Pivot ${quickGamePartition.pivotValue} placed` : `Compare with pivot ${quickGamePartition?.pivotValue}`, "02");
		elements.action.disabled = true;
		elements.action.innerHTML = '<span>Choose the highlighted bar</span>';
		renderQuickGame(false);
		if (quickGamePartition?.pivotPlaced) {
			clearTimeout(quickGameTimer);
			quickGameTimer = undefined;
			advanceQuickRanges();
		}
	} else if (!isVisualizer && phase === "split") {
		setStage("PHASE 01 / DIVIDE", "Split into smaller runs", "01");
		elements.action.disabled = true;
		elements.action.innerHTML = '<span>Splitting…</span><span class="button-loader"></span>';
		renderSplit();
	} else if (!isVisualizer && phase === "merge") {
		setStage("PHASE 02 / CONQUER", "Merge the smallest first", "02");
		elements.action.disabled = false;
		elements.action.innerHTML = '<span>Choose the next number</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6"></path></svg>';
		renderMerge();
	} else if (!isVisualizer && phase === "complete") {
		finishGame(false, gameAlgorithm === "quick" ? quickGameValues : round.sorted, gameAlgorithm === "quick" ? "QUICK SORT COMPLETE" : "SEQUENCE COMPLETE");
	}
	if (!isVisualizer) updateStats();
}

function playTone(frequency, duration = 0.13, type = "sine", volume = 0.08) {
	if (!soundEnabled) return;
	try {
		audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
		if (audioContext.state === "suspended") audioContext.resume();
		const oscillator = audioContext.createOscillator();
		const gain = audioContext.createGain();
		oscillator.type = type;
		oscillator.frequency.setValueAtTime(frequency, audioContext.currentTime);
		gain.gain.setValueAtTime(0.0001, audioContext.currentTime);
		gain.gain.exponentialRampToValueAtTime(volume, audioContext.currentTime + 0.015);
		gain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + duration);
		oscillator.connect(gain).connect(audioContext.destination);
		oscillator.start();
		oscillator.stop(audioContext.currentTime + duration);
	} catch {
	}
}

function burstParticles() {
	const bounds = elements.boardWrap.getBoundingClientRect();
	for (let index = 0; index < 9; index += 1) {
		const particle = document.createElement("i");
		particle.className = "particle";
		particle.style.left = `${Math.random() * bounds.width}px`;
		particle.style.top = `${Math.max(12, bounds.height * 0.47 + (Math.random() - 0.5) * 50)}px`;
		particle.style.setProperty("--drift-x", `${(Math.random() - 0.5) * 92}px`);
		particle.style.setProperty("--drift-y", `${-20 - Math.random() * 68}px`);
		elements.boardWrap.append(particle);
		particle.addEventListener("animationend", () => particle.remove(), { once: true });
	}
}

function choose(value, source) {
	if (phase !== "merge") return;
	const step = round.steps[stepIndex];
	const expected = Math.min(step.left[leftIndex] ?? Infinity, step.right[rightIndex] ?? Infinity);
	const correctSource = step.left[leftIndex] === expected ? "LEFT RUN" : "RIGHT RUN";
	if (value !== expected || source !== correctSource) {
		combo = 0;
		updateStats();
		setHint("Not quite. Compare the front of each run.", "hint-wrong");
		elements.board.classList.remove("shake");
		void elements.board.offsetWidth;
		elements.board.classList.add("shake");
		playTone(155, 0.16, "triangle");
		return;
	}

	step.output.push(value);
	if (source === "LEFT RUN") leftIndex += 1;
	else rightIndex += 1;
	combo += 1;
	score += 100 + Math.max(0, combo - 1) * 25;
	updateStats();
	renderMerge();
	burstParticles();
	playTone(380 + Math.min(combo, 8) * 42, 0.17);
	setHint(combo > 1 ? `Clean merge. ${combo} in a row!` : "Nice pick. Keep the smaller number moving.", "hint-good");

	if (step.output.length === step.left.length + step.right.length) {
		stepIndex += 1;
		leftIndex = 0;
		rightIndex = 0;
		if (stepIndex === round.steps.length) {
			finishGame();
			return;
		}
		setTimeout(() => {
			if (phase !== "merge" || currentMode !== "game") return;
			const nextStep = round.steps[stepIndex];
			setStage(`MERGE ${String(stepIndex + 1).padStart(2, "0")} / ${String(round.steps.length).padStart(2, "0")}`, `Combine ${nextStep.left.length} + ${nextStep.right.length}`, "02");
			renderMerge();
			updateStats();
		}, 410);
	}
}

function finishGame(playEffects = true, sortedValues = round.sorted, completionLabel = "SEQUENCE COMPLETE") {
	phase = "complete";
	updateStats();
	setStage(completionLabel, "Order restored.", "03");
	elements.board.className = "board complete-board";
	elements.board.replaceChildren();
	const row = document.createElement("div");
	row.className = "card-row complete-cards";
	sortedValues.forEach((value, index) => {
		const item = bar(value, "complete-bar", "", "div", gameBarCount);
		item.style.setProperty("--deal-index", index);
		row.append(item);
	});
	const message = document.createElement("p");
	message.className = "complete-message";
	message.textContent = "EVERY NUMBER FOUND ITS PLACE";
	elements.board.append(row, message);
	elements.action.innerHTML = '<span>Play again</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6"></path></svg>';
	setHint(`Perfectly sorted. Final score: ${String(score).padStart(4, "0")}.`, "hint-good");
	if (playEffects && !gameCompletionPlayed) {
		gameCompletionPlayed = true;
		gameSweepSoundTimer = playCompletionSweep([...row.children]);
		burstParticles();
	}
}

function startSorting() {
	if (phase === "complete") {
		resetGame();
		return;
	}
	if (phase !== "ready") return;
	if (gameAlgorithm === "quick") {
		startQuickGame();
		return;
	}
	phase = "split";
	splitLevels = createSplitLevels(round.values);
	splitIndex = 1;
	setStage("PHASE 01 / DIVIDE", "Split into smaller runs", "01");
	elements.action.disabled = true;
	elements.action.innerHTML = '<span>Splitting…</span><span class="button-loader"></span>';
	setHint("Divide and conquer. Watch the sequence break apart.");
	renderSplit();
	playTone(260, 0.12);

	const showNextSplit = () => {
		if (phase !== "split") return;
		if (splitIndex < splitLevels.length - 1) {
			splitIndex += 1;
			if (currentMode === "game") {
				renderSplit();
				playTone(260 - splitIndex * 12, 0.1);
			}
			splitTimer = setTimeout(showNextSplit, SPLIT_DELAY);
			return;
		}
		phase = "merge";
		stepIndex = 0;
		leftIndex = 0;
		rightIndex = 0;
		if (currentMode === "game") {
			setStage("PHASE 02 / CONQUER", "Merge the smallest first", "02");
			elements.action.disabled = false;
			elements.action.innerHTML = '<span>Choose the next number</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6"></path></svg>';
			setHint("Pick the smaller front card from either run.");
			renderMerge();
		}
	};
	splitTimer = setTimeout(showNextSplit, SPLIT_DELAY);
}

function resetGame() {
	clearTimeout(splitTimer);
	clearTimeout(quickGameTimer);
	quickGameTimer = undefined;
	clearCompletionDings(gameSweepSoundTimer);
	gameSweepSoundTimer = undefined;
	round = createRound(gameBarCount, gameBarCount);
	quickGameValues = [...round.values];
	quickGameRanges = [];
	quickGamePartition = undefined;
	quickGameComparisons = 0;
	quickGameComparisonTotal = gameAlgorithm === "quick"
		? createQuickSortFrames(quickGameValues).filter((frame) => frame.type === "compare").length
		: 0;
	phase = "ready";
	stepIndex = 0;
	leftIndex = 0;
	rightIndex = 0;
	score = 0;
	combo = 0;
	gameCompletionPlayed = false;
	setStage("READY WHEN YOU ARE", "Meet your numbers", "01");
	elements.action.disabled = false;
	elements.action.innerHTML = '<span>Start sorting</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6"></path></svg>';
	setHint(`${gameBarCount} numbers. One perfectly sorted row.`);
	renderIntro();
	updateStats();
}

elements.action.addEventListener("click", startSorting);
elements.restart.addEventListener("click", resetGame);
for (const option of elements.gameAlgorithmOptions) option.addEventListener("click", () => setGameAlgorithm(option.dataset.gameAlgorithm));
for (const tab of elements.modeTabs) tab.addEventListener("click", () => setMode(tab.dataset.mode));
for (const option of elements.algorithmOptions) option.addEventListener("click", () => setVisualizerAlgorithm(option.dataset.algorithm));
elements.barCount.addEventListener("input", () => {
	elements.barCountValue.value = elements.barCount.value;
	elements.barCountValue.textContent = elements.barCount.value;
});
elements.barCount.addEventListener("change", () => {
	visualizerBarCount = Number(elements.barCount.value);
	shuffleVisualizer();
});
elements.gameBarCount.addEventListener("input", () => {
	elements.gameBarCountValue.value = elements.gameBarCount.value;
	elements.gameBarCountValue.textContent = elements.gameBarCount.value;
});
elements.gameBarCount.addEventListener("change", () => {
	gameBarCount = Number(elements.gameBarCount.value);
	resetGame();
});
elements.animationSpeed.addEventListener("input", () => {
	elements.speedValue.value = `${elements.animationSpeed.value} ms`;
	elements.speedValue.textContent = elements.speedValue.value;
});
elements.visualizerPlay.addEventListener("click", toggleVisualizer);
elements.visualizerStep.addEventListener("click", stepVisualizer);
elements.shuffleArray.addEventListener("click", shuffleVisualizer);
elements.restartVisualizer.addEventListener("click", restartVisualizer);
window.addEventListener("resize", () => {
	if (currentMode !== "visualizer") return;
	cancelAnimationFrame(resizeFrame);
	resizeFrame = requestAnimationFrame(() => renderVisualizer(false));
});
elements.sound.addEventListener("click", () => {
	soundEnabled = !soundEnabled;
	elements.sound.setAttribute("aria-pressed", String(soundEnabled));
	elements.sound.setAttribute("aria-label", soundEnabled ? "Turn sound off" : "Turn sound on");
	elements.sound.title = soundEnabled ? "Sound on" : "Sound off";
	elements.soundLabel.textContent = soundEnabled ? "SOUND ON" : "SOUND OFF";
});

resetGame();
prepareVisualizer();
