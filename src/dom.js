/* =========================================================================
   DOM ELEMENT REFERENCES & VIEWPORT / LOOP STATE
   ========================================================================= */
export const appRoot = document.getElementById('appRoot');
export const worldStage = document.getElementById('worldStage');
export const worldCanvas = document.getElementById('worldCanvas');
export const wCtx = worldCanvas.getContext('2d');
export const tabRestoreChip = document.getElementById('tabRestoreChip');

export const modePlayBtn = document.getElementById('modePlayBtn');
export const modeBuildBtn = document.getElementById('modeBuildBtn');
export const pausedBadge = document.getElementById('pausedBadge');
export const buildOnlyGroup = document.getElementById('buildOnlyGroup');
export const toolStampBtn = document.getElementById('toolStampBtn');
export const toolRectBtn = document.getElementById('toolRectBtn');
export const toolLineBtn = document.getElementById('toolLineBtn');
export const toolEraseBtn = document.getElementById('toolEraseBtn');
export const toolSpawnBtn = document.getElementById('toolSpawnBtn');
export const centerCamBtn = document.getElementById('centerCamBtn');
export const coordPill = document.getElementById('coordPill');
export const saveDot = document.getElementById('saveDot');
export const topWorldName = document.getElementById('topWorldName');
export const openWorldsBtn = document.getElementById('openWorldsBtn');
export const audioMenuBtn = document.getElementById('audioMenuBtn');
export const audioMenuIco = document.getElementById('audioMenuIco');
export const audioPopover = document.getElementById('audioPopover');
export const musicPlayToggleBtn = document.getElementById('musicPlayToggleBtn');
export const sfxMuteBtn = document.getElementById('sfxMuteBtn');
export const sfxVolSlider = document.getElementById('sfxVolSlider');
export const sfxVolVal = document.getElementById('sfxVolVal');
export const musicMuteBtn = document.getElementById('musicMuteBtn');
export const musicVolSlider = document.getElementById('musicVolSlider');
export const musicVolVal = document.getElementById('musicVolVal');
export const audioTrackList = document.getElementById('audioTrackList');
export const audioLiveDot = document.getElementById('audioLiveDot');
export const audioStatusText = document.getElementById('audioStatusText');
export const zoomReadoutBtn = document.getElementById('zoomReadoutBtn');
export const hideUiBtn = document.getElementById('hideUiBtn');

export const openCreateBtn = document.getElementById('openCreateBtn');
export const draftBar = document.getElementById('draftBar');
export const draftThumbCanvas = document.getElementById('draftThumbCanvas');
export const draftNameEl = document.getElementById('draftNameEl');
export const resumeDraftBtn = document.getElementById('resumeDraftBtn');
export const discardDraftBtn = document.getElementById('discardDraftBtn');
export const filterBar = document.getElementById('filterBar');
export const spriteCount = document.getElementById('spriteCount');
export const wireframeResetBtn = document.getElementById('wireframeResetBtn');
export const emptyState = document.getElementById('emptyState');
export const spriteGrid = document.getElementById('spriteGrid');

export const dialogueBox = document.getElementById('dialogueBox');
export const dialogueTitle = document.getElementById('dialogueTitle');
export const dialogueText = document.getElementById('dialogueText');
export const viewableModal = document.getElementById('viewableModal');
export const viewableTitle = document.getElementById('viewableTitle');
export const closeViewableX = document.getElementById('closeViewableX');
export const viewableCanvas = document.getElementById('viewableCanvas');
export const vCtx = viewableCanvas.getContext('2d');
export const viewableCaption = document.getElementById('viewableCaption');
export const closeViewableBtn = document.getElementById('closeViewableBtn');

export const worldsModal = document.getElementById('worldsModal');
export const closeWorldsX = document.getElementById('closeWorldsX');
export const closeWorldsBtn = document.getElementById('closeWorldsBtn');
export const newWorldBtn = document.getElementById('newWorldBtn');
export const exportDataBtn = document.getElementById('exportDataBtn');
export const importDataBtn = document.getElementById('importDataBtn');
export const importFileInput = document.getElementById('importFileInput');
export const worldsList = document.getElementById('worldsList');

export const editorModal = document.getElementById('editorModal');
export const spriteNameInput = document.getElementById('spriteNameInput');
export const editorTypeBtn = document.getElementById('editorTypeBtn');
export const editorTypeBtnIcon = document.getElementById('editorTypeBtnIcon');
export const editorTypeBtnLabel = document.getElementById('editorTypeBtnLabel');
export const editorSubTypeSelect = document.getElementById('editorSubTypeSelect');
export const sizeDecBtn = document.getElementById('sizeDecBtn');
export const sizeValInput = document.getElementById('sizeValInput');
export const sizeIncBtn = document.getElementById('sizeIncBtn');
export const sizeDecBtn2 = document.getElementById('sizeDecBtn2');
export const sizeValInput2 = document.getElementById('sizeValInput2');
export const sizeIncBtn2 = document.getElementById('sizeIncBtn2');
export const openPngBtn = document.getElementById('openPngBtn');
export const pngFileInput = document.getElementById('pngFileInput');
export const pasteBtn = document.getElementById('pasteBtn');
export const exportPngBtn = document.getElementById('exportPngBtn');
export const closeEditorX = document.getElementById('closeEditorX');

export const deselectBtn = document.getElementById('deselectBtn');
export const brushSizeBtn = document.getElementById('brushSizeBtn');
export const brushShapeBtn = document.getElementById('brushShapeBtn');
export const shapeFillBtn = document.getElementById('shapeFillBtn');
export const mirrorXBtn = document.getElementById('mirrorXBtn');
export const onionBtn = document.getElementById('onionBtn');
export const flipHBtn = document.getElementById('flipHBtn');
export const flipVBtn = document.getElementById('flipVBtn');
export const undoBtn = document.getElementById('undoBtn');
export const redoBtn = document.getElementById('redoBtn');
export const rotateBtn = document.getElementById('rotateBtn');
export const clearFrameBtn = document.getElementById('clearFrameBtn');

export const stripBar = document.getElementById('stripBar');
export const stripInfo = document.getElementById('stripInfo');
export const stripFrameWidthInput = document.getElementById('stripFrameWidthInput');
export const sliceStripBtn = document.getElementById('sliceStripBtn');
export const fitStripBtn = document.getElementById('fitStripBtn');
export const dismissStripBtn = document.getElementById('dismissStripBtn');

export const editorStageScroll = document.getElementById('editorStageScroll');
export const edBrushHud = document.getElementById('edBrushHud');
export const editorCanvasFrame = document.getElementById('editorCanvasFrame');
export const editorCanvas = document.getElementById('editorCanvas');
export const eCtx = editorCanvas.getContext('2d');
export const edCursorCoord = document.getElementById('edCursorCoord');
export const edZoomOutBtn = document.getElementById('edZoomOutBtn');
export const edZoomLabel = document.getElementById('edZoomLabel');
export const edZoomInBtn = document.getElementById('edZoomInBtn');
export const edZoomFitBtn = document.getElementById('edZoomFitBtn');
export const edGridBtn = document.getElementById('edGridBtn');
export const fitPasteCheck = document.getElementById('fitPasteCheck');

export const addSwatchBtn = document.getElementById('addSwatchBtn');
export const resetPaletteBtn = document.getElementById('resetPaletteBtn');
export const paletteGrid = document.getElementById('paletteGrid');
export const svPickerWrap = document.getElementById('svPickerWrap');
export const svCanvas = document.getElementById('svCanvas');
export const svCtx = svCanvas.getContext('2d');
export const hueBarWrap = document.getElementById('hueBarWrap');
export const hueCanvas = document.getElementById('hueCanvas');
export const hueCtx = hueCanvas.getContext('2d');
export const colorPreviewSwatch = document.getElementById('colorPreviewSwatch');
export const hexInput = document.getElementById('hexInput');

export const playAnimBtn = document.getElementById('playAnimBtn');
export const playAnimIco = document.getElementById('playAnimIco');
export const previewStateLabel = document.getElementById('previewStateLabel');
export const fpsStepper = document.getElementById('fpsStepper');
export const fpsDecBtn = document.getElementById('fpsDecBtn');
export const fpsValEl = document.getElementById('fpsValEl');
export const fpsIncBtn = document.getElementById('fpsIncBtn');
export const previewTile1Btn = document.getElementById('previewTile1Btn');
export const previewTile3Btn = document.getElementById('previewTile3Btn');
export const previewTypeBadge = document.getElementById('previewTypeBadge');
export const previewCanvas = document.getElementById('previewCanvas');
export const pCtx = previewCanvas.getContext('2d');

export const bodyStateTabsWrap = document.getElementById('bodyStateTabsWrap');
export const bodyStateTabs = document.getElementById('bodyStateTabs');
export const blinkGuideHint = document.getElementById('blinkGuideHint');

export const editorLightOptsWrap = document.getElementById('editorLightOptsWrap');
export const lightColorInfoRow = document.getElementById('lightColorInfoRow');
export const lightColorChip = document.getElementById('lightColorChip');
export const lightColorLabel = document.getElementById('lightColorLabel');
export const setFirstPaletteBtn = document.getElementById('setFirstPaletteBtn');
export const lightStdOptsRow = document.getElementById('lightStdOptsRow');
export const lightPulsatingCheck = document.getElementById('lightPulsatingCheck');
export const lightThickCheck = document.getElementById('lightThickCheck');
export const lightTopNoteRow = document.getElementById('lightTopNoteRow');
export const lightFillModeRow = document.getElementById('lightFillModeRow');
export const lightFillModeSelect = document.getElementById('lightFillModeSelect');
export const lightSurroundRow = document.getElementById('lightSurroundRow');
export const lightSurroundSelect = document.getElementById('lightSurroundSelect');
export const lightGlowOptsWrap = document.getElementById('lightGlowOptsWrap');
export const lightGlowBehaviorSelect = document.getElementById('lightGlowBehaviorSelect');
export const lightGlowStyleSelect = document.getElementById('lightGlowStyleSelect');

export const editorCustomTextWrap = document.getElementById('editorCustomTextWrap');
export const editorCustomTextLbl = document.getElementById('editorCustomTextLbl');
export const editorCustomTextInput = document.getElementById('editorCustomTextInput');

export const editorEnvOptsWrap = document.getElementById('editorEnvOptsWrap');
export const envAttrNote = document.getElementById('envAttrNote');
export const envIntensityRow = document.getElementById('envIntensityRow');
export const envIntensitySelect = document.getElementById('envIntensitySelect');
export const envWindOptsWrap = document.getElementById('envWindOptsWrap');
export const envWindDirSelect = document.getElementById('envWindDirSelect');
export const envWindStrengthSelect = document.getElementById('envWindStrengthSelect');

export const editorLiquidOptsWrap = document.getElementById('editorLiquidOptsWrap');
export const liquidBreathableCheck = document.getElementById('liquidBreathableCheck');

export const editorHarmOptsWrap = document.getElementById('editorHarmOptsWrap');
export const harmAttrNote = document.getElementById('harmAttrNote');
export const harmStrengthRow = document.getElementById('harmStrengthRow');
export const harmStrengthSelect = document.getElementById('harmStrengthSelect');

export const celsStrip = document.getElementById('celsStrip');
export const prevFrameBtn = document.getElementById('prevFrameBtn');
export const nextFrameBtn = document.getElementById('nextFrameBtn');
export const addFrameBtn = document.getElementById('addFrameBtn');
export const delFrameBtn = document.getElementById('delFrameBtn');
export const dupFrameBtn = document.getElementById('dupFrameBtn');
export const edPlacedBadge = document.getElementById('edPlacedBadge');
export const editorMsg = document.getElementById('editorMsg');
export const edDraftStatus = document.getElementById('edDraftStatus');
export const cancelSpriteBtn = document.getElementById('cancelSpriteBtn');
export const saveCopySpriteBtn = document.getElementById('saveCopySpriteBtn');
export const saveSpriteBtn = document.getElementById('saveSpriteBtn');

export const typePickerModal = document.getElementById('typePickerModal');
export const tpSearchInput = document.getElementById('tpSearchInput');
export const closeTypePickerX = document.getElementById('closeTypePickerX');
export const tpGrid = document.getElementById('tpGrid');
export const tpDescBar = document.getElementById('tpDescBar');

export const toastEl = document.getElementById('toast');
export const uiTooltip = document.getElementById('uiTooltip');

export const sessionLockOverlay = document.getElementById('sessionLockOverlay');
export const sessionLockStatus = document.getElementById('sessionLockStatus');
export const sessionLockTitle = document.getElementById('sessionLockTitle');
export const sessionLockMsg = document.getElementById('sessionLockMsg');
export const sessionLockTakeoverBtn = document.getElementById('sessionLockTakeoverBtn');
export const sessionLockCloseBtn = document.getElementById('sessionLockCloseBtn');
export const sessionLockCloseNote = document.getElementById('sessionLockCloseNote');

let toastTimer = null;
let saveDotTimer = null;

export function showToast(msg) {
  toastEl.textContent = String(msg || '').toUpperCase();
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1800);
}

export function flashSavedDot() {
  saveDot.classList.add('show');
  clearTimeout(saveDotTimer);
  saveDotTimer = setTimeout(() => saveDot.classList.remove('show'), 1100);
}

export function isAnyModalOpen() {
  return (
    sessionLockOverlay.classList.contains('open') ||
    editorModal.classList.contains('open') ||
    worldsModal.classList.contains('open') ||
    typePickerModal.classList.contains('open') ||
    viewableModal.classList.contains('open')
  );
}
