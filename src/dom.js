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
export const buildPauseCorner = document.getElementById('buildPauseCorner');
export const buildPauseIco = document.getElementById('buildPauseIco');
export const buildOnlyGroup = document.getElementById('buildOnlyGroup');
export const toolStampBtn = document.getElementById('toolStampBtn');
export const toolRectBtn = document.getElementById('toolRectBtn');
export const toolLineBtn = document.getElementById('toolLineBtn');
export const toolEraseBtn = document.getElementById('toolEraseBtn');
export const buildMoreBtn = document.getElementById('buildMoreBtn');
export const buildMoreLabel = document.getElementById('buildMoreLabel');
export const buildMorePopover = document.getElementById('buildMorePopover');
export const toolSpawnBtn = document.getElementById('toolSpawnBtn');
export const toolWireBtn = document.getElementById('toolWireBtn');
export const toolLinkBtn = document.getElementById('toolLinkBtn');
export const blueprintBar = document.getElementById('blueprintBar');
export const bpStatsEl = document.getElementById('bpStatsEl');
export const bpNormBtn = document.getElementById('bpNormBtn');
export const bpInvBtn = document.getElementById('bpInvBtn');
export const bpClearAllBtn = document.getElementById('bpClearAllBtn');
export const bpExitBtn = document.getElementById('bpExitBtn');
export const centerCamBtn = document.getElementById('centerCamBtn');
export const coordPill = document.getElementById('coordPill');
export const saveDot = document.getElementById('saveDot');
export const topWorldName = document.getElementById('topWorldName');
export const openWorldsBtn = document.getElementById('openWorldsBtn');
export const zoomOutTopBtn = document.getElementById('zoomOutTopBtn');
export const zoomInTopBtn = document.getElementById('zoomInTopBtn');
export const physMenuBtn = document.getElementById('physMenuBtn');
export const physPopover = document.getElementById('physPopover');
export const physTimeGroup = document.getElementById('physTimeGroup');
export const physGravGroup = document.getElementById('physGravGroup');
export const physWiresToggleBtn = document.getElementById('physWiresToggleBtn');
export const physResetBtn = document.getElementById('physResetBtn');
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
export const pixoMenuBtn = document.getElementById('pixoMenuBtn');
export const pixoPopover = document.getElementById('pixoPopover');
export const pixoTooltipsToggleBtn = document.getElementById('pixoTooltipsToggleBtn');
export const pixoReplayBtn = document.getElementById('pixoReplayBtn');
export const pixoIdeaBtn = document.getElementById('pixoIdeaBtn');
export const pixoBuddy = document.getElementById('pixoBuddy');
export const pixoAvatarBtn = document.getElementById('pixoAvatarBtn');
export const pixoSpriteImg = document.getElementById('pixoSpriteImg');
export const pixoSparks = document.getElementById('pixoSparks');
export const pixoStepBadge = document.getElementById('pixoStepBadge');
export const pixoBubbleTipsBtn = document.getElementById('pixoBubbleTipsBtn');
export const pixoText = document.getElementById('pixoText');
export const pixoTasks = document.getElementById('pixoTasks');
export const pixoSkipBtn = document.getElementById('pixoSkipBtn');
export const pixoDots = document.getElementById('pixoDots');
export const pixoNextBtn = document.getElementById('pixoNextBtn');
export const zoomReadoutBtn = document.getElementById('zoomReadoutBtn');
export const hideUiBtn = document.getElementById('hideUiBtn');

export const openCreateBtn = document.getElementById('openCreateBtn');
export const draftBar = document.getElementById('draftBar');
export const draftThumbCanvas = document.getElementById('draftThumbCanvas');
export const draftNameEl = document.getElementById('draftNameEl');
export const resumeDraftBtn = document.getElementById('resumeDraftBtn');
export const discardDraftBtn = document.getElementById('discardDraftBtn');
export const filterBar = document.getElementById('filterBar');
export const spriteSearchInput = document.getElementById('spriteSearchInput');
export const spriteSearchClearBtn = document.getElementById('spriteSearchClearBtn');
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
export const worldsCountBadge = document.getElementById('worldsCountBadge');
export const closeWorldsX = document.getElementById('closeWorldsX');
export const closeWorldsBtn = document.getElementById('closeWorldsBtn');
export const newWorldBtn = document.getElementById('newWorldBtn');
export const worldSearchInput = document.getElementById('worldSearchInput');
export const worldSearchClearBtn = document.getElementById('worldSearchClearBtn');
export const worldSortSelect = document.getElementById('worldSortSelect');
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
export const edSizeGroup = document.getElementById('edSizeGroup');
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

export const symmetryBar = document.getElementById('symmetryBar');
export const symAxisHBtn = document.getElementById('symAxisHBtn');
export const symAxisVBtn = document.getElementById('symAxisVBtn');
export const symAxisD1Btn = document.getElementById('symAxisD1Btn');
export const symAxisD2Btn = document.getElementById('symAxisD2Btn');
export const symXDecBtn = document.getElementById('symXDecBtn');
export const symXVal = document.getElementById('symXVal');
export const symXIncBtn = document.getElementById('symXIncBtn');
export const symYDecBtn = document.getElementById('symYDecBtn');
export const symYVal = document.getElementById('symYVal');
export const symYIncBtn = document.getElementById('symYIncBtn');
export const symCenterBtn = document.getElementById('symCenterBtn');
export const symOffBtn = document.getElementById('symOffBtn');

export const fxHslBtn = document.getElementById('fxHslBtn');
export const fxOutlineBtn = document.getElementById('fxOutlineBtn');
export const fxReplaceBtn = document.getElementById('fxReplaceBtn');
export const edFxBar = document.getElementById('edFxBar');
export const fxTitleEl = document.getElementById('fxTitleEl');
export const fxScopeBtn = document.getElementById('fxScopeBtn');
export const fxCancelBtn = document.getElementById('fxCancelBtn');
export const fxApplyBtn = document.getElementById('fxApplyBtn');
export const fxPanelHsl = document.getElementById('fxPanelHsl');
export const fxHueSlider = document.getElementById('fxHueSlider');
export const fxHueVal = document.getElementById('fxHueVal');
export const fxSatSlider = document.getElementById('fxSatSlider');
export const fxSatVal = document.getElementById('fxSatVal');
export const fxValSlider = document.getElementById('fxValSlider');
export const fxValVal = document.getElementById('fxValVal');
export const fxAlphaSlider = document.getElementById('fxAlphaSlider');
export const fxAlphaVal = document.getElementById('fxAlphaVal');
export const fxHslResetBtn = document.getElementById('fxHslResetBtn');
export const fxPanelOutline = document.getElementById('fxPanelOutline');
export const fxOutColorChip = document.getElementById('fxOutColorChip');
export const fxOutPickBtn = document.getElementById('fxOutPickBtn');
export const fxOutBrushBtn = document.getElementById('fxOutBrushBtn');
export const fxOutBlackBtn = document.getElementById('fxOutBlackBtn');
export const fxOut4Btn = document.getElementById('fxOut4Btn');
export const fxOut8Btn = document.getElementById('fxOut8Btn');
export const fxOutOuterBtn = document.getElementById('fxOutOuterBtn');
export const fxOutInnerBtn = document.getElementById('fxOutInnerBtn');
export const fxPanelReplace = document.getElementById('fxPanelReplace');
export const fxRepFromChip = document.getElementById('fxRepFromChip');
export const fxRepFromPickBtn = document.getElementById('fxRepFromPickBtn');
export const fxRepSwapBtn = document.getElementById('fxRepSwapBtn');
export const fxRepToChip = document.getElementById('fxRepToChip');
export const fxRepToPickBtn = document.getElementById('fxRepToPickBtn');
export const fxRepToTransBtn = document.getElementById('fxRepToTransBtn');
export const fxRepTolSlider = document.getElementById('fxRepTolSlider');
export const fxRepTolVal = document.getElementById('fxRepTolVal');

export const editorStageScroll = document.getElementById('editorStageScroll');
export const edBrushHud = document.getElementById('edBrushHud');
export const editorCanvasFrame = document.getElementById('editorCanvasFrame');
export const editorCanvas = document.getElementById('editorCanvas');
export const eCtx = editorCanvas.getContext('2d');
export const edCursorCoord = document.getElementById('edCursorCoord');
export const edToolStatus = document.getElementById('edToolStatus');
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
export const alphaBarWrap = document.getElementById('alphaBarWrap');
export const alphaCanvas = document.getElementById('alphaCanvas');
export const alphaCtx = alphaCanvas.getContext('2d');
export const alphaValEl = document.getElementById('alphaValEl');
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
export const liquidAttrNote = document.getElementById('liquidAttrNote');
export const liquidBreathableCheck = document.getElementById('liquidBreathableCheck');
export const liquidThickCheck = document.getElementById('liquidThickCheck');
export const liquidHazardSelect = document.getElementById('liquidHazardSelect');

export const editorHarmOptsWrap = document.getElementById('editorHarmOptsWrap');
export const harmAttrNote = document.getElementById('harmAttrNote');
export const harmStrengthRow = document.getElementById('harmStrengthRow');
export const harmStrengthSelect = document.getElementById('harmStrengthSelect');
export const harmEmergeDirRow = document.getElementById('harmEmergeDirRow');
export const harmEmergeDirSelect = document.getElementById('harmEmergeDirSelect');
export const harmMoveAxisRow = document.getElementById('harmMoveAxisRow');
export const harmMoveAxisSelect = document.getElementById('harmMoveAxisSelect');
export const harmSpeedRow = document.getElementById('harmSpeedRow');
export const harmSpeedSelect = document.getElementById('harmSpeedSelect');
export const harmSolidCheck = document.getElementById('harmSolidCheck');
export const harmInFrontCheck = document.getElementById('harmInFrontCheck');
export const harmKnockbackWrap = document.getElementById('harmKnockbackWrap');
export const harmKnockbackCheck = document.getElementById('harmKnockbackCheck');

export const editorBackOptsWrap = document.getElementById('editorBackOptsWrap');
export const backAttrNote = document.getElementById('backAttrNote');
export const backSmartFillRow = document.getElementById('backSmartFillRow');
export const backSmartFillCheck = document.getElementById('backSmartFillCheck');

export const editorThingOptsWrap = document.getElementById('editorThingOptsWrap');
export const thingAttrNote = document.getElementById('thingAttrNote');
export const thingFurryLayoutRow = document.getElementById('thingFurryLayoutRow');
export const thingFurryLayoutSelect = document.getElementById('thingFurryLayoutSelect');
export const thingFurryStyleRow = document.getElementById('thingFurryStyleRow');
export const thingFurryStyleSelect = document.getElementById('thingFurryStyleSelect');
export const thingFurryRipRow = document.getElementById('thingFurryRipRow');
export const thingFurryRipSelect = document.getElementById('thingFurryRipSelect');
export const thingClothyLayoutRow = document.getElementById('thingClothyLayoutRow');
export const thingClothyLayoutSelect = document.getElementById('thingClothyLayoutSelect');
export const thingDriftyParticlesRow = document.getElementById('thingDriftyParticlesRow');
export const thingDriftyParticlesCheck = document.getElementById('thingDriftyParticlesCheck');
export const thingLightweightRow = document.getElementById('thingLightweightRow');
export const thingLightweightCheck = document.getElementById('thingLightweightCheck');
export const thingLightweightLabel = document.getElementById('thingLightweightLabel');
export const thingInFrontRow = document.getElementById('thingInFrontRow');
export const thingInFrontCheck = document.getElementById('thingInFrontCheck');

export const editorChangingOptsWrap = document.getElementById('editorChangingOptsWrap');
export const changingAttrNote = document.getElementById('changingAttrNote');
export const changingTouchSoundRow = document.getElementById('changingTouchSoundRow');
export const changingTouchSoundSelect = document.getElementById('changingTouchSoundSelect');
export const testChangingSoundBtn = document.getElementById('testChangingSoundBtn');
export const changingThrowOptsWrap = document.getElementById('changingThrowOptsWrap');
export const changingThrowItemSelect = document.getElementById('changingThrowItemSelect');
export const changingThrowIntervalSelect = document.getElementById('changingThrowIntervalSelect');

export const editorFarbackOptsWrap = document.getElementById('editorFarbackOptsWrap');
export const farbackAttrNote = document.getElementById('farbackAttrNote');
export const farbackMiniWrap = document.getElementById('farbackMiniWrap');
export const farbackMiniPreview = document.getElementById('farbackMiniPreview');
export const farbackMiniCtx = farbackMiniPreview ? farbackMiniPreview.getContext('2d') : null;
export const farbackSummaryNote = document.getElementById('farbackSummaryNote');
export const openFarbackStudioBtn = document.getElementById('openFarbackStudioBtn');
export const farbackLayerOverRow = document.getElementById('farbackLayerOverRow');
export const farbackLayerOverCheck = document.getElementById('farbackLayerOverCheck');

export const sceneryModal = document.getElementById('sceneryModal');
export const scWorldPill = document.getElementById('scWorldPill');
export const scLayerCountPill = document.getElementById('scLayerCountPill');
export const scZoomOutBtn = document.getElementById('scZoomOutBtn');
export const scZoomResetBtn = document.getElementById('scZoomResetBtn');
export const scZoomInBtn = document.getElementById('scZoomInBtn');
export const scGridBtn = document.getElementById('scGridBtn');
export const scPreviewBtn = document.getElementById('scPreviewBtn');
export const closeSceneryX = document.getElementById('closeSceneryX');
export const closeSceneryBtn = document.getElementById('closeSceneryBtn');
export const scAddLayerBtn = document.getElementById('scAddLayerBtn');
export const scLayerList = document.getElementById('scLayerList');
export const scLayerProps = document.getElementById('scLayerProps');
export const scDepthBadge = document.getElementById('scDepthBadge');
export const scDepthSlider = document.getElementById('scDepthSlider');
export const scDepthVal = document.getElementById('scDepthVal');
export const scTintSlider = document.getElementById('scTintSlider');
export const scTintVal = document.getElementById('scTintVal');
export const scHeightSlider = document.getElementById('scHeightSlider');
export const scHeightVal = document.getElementById('scHeightVal');
export const scOpacitySlider = document.getElementById('scOpacitySlider');
export const scOpacityVal = document.getElementById('scOpacityVal');
export const scDriftSelect = document.getElementById('scDriftSelect');
export const scTileXCheck = document.getElementById('scTileXCheck');
export const scAutoScaleCheck = document.getElementById('scAutoScaleCheck');
export const scBottomFadeCheck = document.getElementById('scBottomFadeCheck');
export const scToolGroup = document.getElementById('scToolGroup');
export const scDeselectBtn = document.getElementById('scDeselectBtn');
export const scShapeFillBtn = document.getElementById('scShapeFillBtn');
export const scSizeGroup = document.getElementById('scSizeGroup');
export const scUndoBtn = document.getElementById('scUndoBtn');
export const scRedoBtn = document.getElementById('scRedoBtn');
export const scShiftLBtn = document.getElementById('scShiftLBtn');
export const scShiftRBtn = document.getElementById('scShiftRBtn');
export const scSoloBtn = document.getElementById('scSoloBtn');
export const scClearBtn = document.getElementById('scClearBtn');
export const scCtxInfo = document.getElementById('scCtxInfo');
export const scCoordEl = document.getElementById('scCoordEl');
export const scToolStatus = document.getElementById('scToolStatus');
export const scCtxHint = document.getElementById('scCtxHint');
export const scCtxPoly = document.getElementById('scCtxPoly');
export const scPolyHint = document.getElementById('scPolyHint');
export const scPolyFinishBtn = document.getElementById('scPolyFinishBtn');
export const scPolyCancelBtn = document.getElementById('scPolyCancelBtn');
export const scCtxStamp = document.getElementById('scCtxStamp');
export const scStampStrip = document.getElementById('scStampStrip');
export const scStampScaleGroup = document.getElementById('scStampScaleGroup');
export const scStampFlipBtn = document.getElementById('scStampFlipBtn');
export const scStageWrap = document.getElementById('scStageWrap');
export const scCanvasFrame = document.getElementById('scCanvasFrame');
export const scCanvas = document.getElementById('scCanvas');
export const scCtx = scCanvas ? scCanvas.getContext('2d') : null;
export const scPickSkyBtn = document.getElementById('scPickSkyBtn');
export const scSvWrap = document.getElementById('scSvWrap');
export const scSvCanvas = document.getElementById('scSvCanvas');
export const scSvCtx = scSvCanvas ? scSvCanvas.getContext('2d') : null;
export const scHueWrap = document.getElementById('scHueWrap');
export const scHueCanvas = document.getElementById('scHueCanvas');
export const scHueCtx = scHueCanvas ? scHueCanvas.getContext('2d') : null;
export const scAlphaWrap = document.getElementById('scAlphaWrap');
export const scAlphaCanvas = document.getElementById('scAlphaCanvas');
export const scAlphaCtx = scAlphaCanvas ? scAlphaCanvas.getContext('2d') : null;
export const scAlphaVal = document.getElementById('scAlphaVal');
export const scColorSwatch = document.getElementById('scColorSwatch');
export const scHexInput = document.getElementById('scHexInput');
export const scPaletteGrid = document.getElementById('scPaletteGrid');
export const scSkyChip = document.getElementById('scSkyChip');
export const scAtmoNote = document.getElementById('scAtmoNote');
export const scStatusMsg = document.getElementById('scStatusMsg');

export const editorBigOptsWrap = document.getElementById('editorBigOptsWrap');
export const bigAttrNote = document.getElementById('bigAttrNote');
export const bigPlacementRow = document.getElementById('bigPlacementRow');
export const bigPlacementSelect = document.getElementById('bigPlacementSelect');
export const bigFxRow = document.getElementById('bigFxRow');
export const bigFxSelect = document.getElementById('bigFxSelect');
export const bigClimbRow = document.getElementById('bigClimbRow');
export const bigClimbableCheck = document.getElementById('bigClimbableCheck');
export const bigTransformWrap = document.getElementById('bigTransformWrap');
export const bigIntervalInput = document.getElementById('bigIntervalInput');
export const bigIntervalUnitSelect = document.getElementById('bigIntervalUnitSelect');
export const bigStartPointSelect = document.getElementById('bigStartPointSelect');
export const bigRepeatCheck = document.getElementById('bigRepeatCheck');
export const bigGiveItemSelect = document.getElementById('bigGiveItemSelect');

export const editorActOptsWrap = document.getElementById('editorActOptsWrap');
export const actAttrNote = document.getElementById('actAttrNote');
export const actSwitchModeRow = document.getElementById('actSwitchModeRow');
export const actSwitchModeSelect = document.getElementById('actSwitchModeSelect');
export const actDurationRow = document.getElementById('actDurationRow');
export const actDurationSelect = document.getElementById('actDurationSelect');
export const actIntervalRow = document.getElementById('actIntervalRow');
export const actIntervalSelect = document.getElementById('actIntervalSelect');
export const actRangeRow = document.getElementById('actRangeRow');
export const actRangeSelect = document.getElementById('actRangeSelect');
export const actDelayRow = document.getElementById('actDelayRow');
export const actDelaySelect = document.getElementById('actDelaySelect');
export const actChangeSolidRow = document.getElementById('actChangeSolidRow');
export const actChangeSolidSelect = document.getElementById('actChangeSolidSelect');

export const editorPropOptsWrap = document.getElementById('editorPropOptsWrap');
export const surfaceSoundRow = document.getElementById('surfaceSoundRow');
export const surfaceSoundSelect = document.getElementById('surfaceSoundSelect');
export const testSurfaceSoundBtn = document.getElementById('testSurfaceSoundBtn');
export const poseActionRow = document.getElementById('poseActionRow');
export const poseActionSelect = document.getElementById('poseActionSelect');

export const celsStrip = document.getElementById('celsStrip');
export const edFrameCounter = document.getElementById('edFrameCounter');
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
export const tpCountBadge = document.getElementById('tpCountBadge');
export const tpSearchInput = document.getElementById('tpSearchInput');
export const tpSearchClearBtn = document.getElementById('tpSearchClearBtn');
export const tpCatBar = document.getElementById('tpCatBar');
export const closeTypePickerX = document.getElementById('closeTypePickerX');
export const tpGrid = document.getElementById('tpGrid');
export const tpDescBar = document.getElementById('tpDescBar');

export const loadingScreen = document.getElementById('loadingScreen');
export const loadingBarFill = document.getElementById('loadingBarFill');
export const loadingPct = document.getElementById('loadingPct');
export const loadingStatus = document.getElementById('loadingStatus');

export const welcomeOverlay = document.getElementById('welcomeOverlay');
export const welcomeCubeWrap = document.getElementById('welcomeCubeWrap');
export const welcomeCubeCanvas = document.getElementById('welcomeCubeCanvas');
export const welcomeHeroLogo = document.getElementById('welcomeHeroLogo');
export const welcomePlayBtn = document.getElementById('welcomePlayBtn');
export const welcomePlayFlood = document.getElementById('welcomePlayFlood');

export const toastEl = document.getElementById('toast');
export const uiTooltip = document.getElementById('uiTooltip');

export const sessionLockOverlay = document.getElementById('sessionLockOverlay');
export const sessionLockPixoBtn = document.getElementById('sessionLockPixoBtn');
export const sessionLockPixoImg = document.getElementById('sessionLockPixoImg');
export const sessionLockStatus = document.getElementById('sessionLockStatus');
export const sessionLockTitle = document.getElementById('sessionLockTitle');
export const sessionLockMsg = document.getElementById('sessionLockMsg');
export const sessionLockTakeoverBtn = document.getElementById('sessionLockTakeoverBtn');
export const sessionLockCloseBtn = document.getElementById('sessionLockCloseBtn');
export const sessionLockCloseNote = document.getElementById('sessionLockCloseNote');

export const chatBar = document.getElementById('chatBar');
export const chatInput = document.getElementById('chatInput');
export const chatSendBtn = document.getElementById('chatSendBtn');

export const motionBar = document.getElementById('motionBar');
export const motionBarBodyName = document.getElementById('motionBarBodyName');
export const motionBarSlots = document.getElementById('motionBarSlots');
export const motionBarCloseBtn = document.getElementById('motionBarCloseBtn');
export const motionPickerPop = document.getElementById('motionPickerPop');
export const motionPickerList = document.getElementById('motionPickerList');

export const editorMotionOptsWrap = document.getElementById('editorMotionOptsWrap');
export const motionAttrNote = document.getElementById('motionAttrNote');
export const motionRenderModeSelect = document.getElementById('motionRenderModeSelect');
export const motionPlayModeSelect = document.getElementById('motionPlayModeSelect');
export const motionKeywordsRow = document.getElementById('motionKeywordsRow');
export const motionKeywordsInput = document.getElementById('motionKeywordsInput');
export const motionParticlesSelect = document.getElementById('motionParticlesSelect');
export const motionHideBodyCheck = document.getElementById('motionHideBodyCheck');
export const motionLaunchFxCheck = document.getElementById('motionLaunchFxCheck');

export const editorDynOptsWrap = document.getElementById('editorDynOptsWrap');
export const dynAttrNote = document.getElementById('dynAttrNote');
export const dynSizePresetGroup = document.getElementById('dynSizePresetGroup');
export const dynInspectorSummary = document.getElementById('dynInspectorSummary');
export const openDynStudioBtn = document.getElementById('openDynStudioBtn');
export const dynInspectorPivotReadout = document.getElementById('dynInspectorPivotReadout');
export const dynInspectorPivotBtn = document.getElementById('dynInspectorPivotBtn');
export const dynStudioModal = document.getElementById('dynStudioModal');
export const dynStudioNamePill = document.getElementById('dynStudioNamePill');
export const dynStudioModePill = document.getElementById('dynStudioModePill');
export const dynStudioCelsPill = document.getElementById('dynStudioCelsPill');
export const closeDynStudioX = document.getElementById('closeDynStudioX');
export const closeDynStudioBtn = document.getElementById('closeDynStudioBtn');
export const dynStudioPreviewCanvas = document.getElementById('dynStudioPreviewCanvas');
export const dynStudioTimeEl = document.getElementById('dynStudioTimeEl');
export const dynStudioPlayBtn = document.getElementById('dynStudioPlayBtn');
export const dynStudioRestartBtn = document.getElementById('dynStudioRestartBtn');
export const dynStudioCelStrip = document.getElementById('dynStudioCelStrip');
export const dynPivotCtrBtn = document.getElementById('dynPivotCtrBtn');
export const dynPivotBotBtn = document.getElementById('dynPivotBotBtn');
export const dynPivotTopBtn = document.getElementById('dynPivotTopBtn');
export const dynMarkerPills = document.getElementById('dynMarkerPills');
export const dynRecipeGrid = document.getElementById('dynRecipeGrid');
export const dynActValField = document.getElementById('dynActValField');
export const dynActValLbl = document.getElementById('dynActValLbl');
export const dynStepsHeaderLbl = document.getElementById('dynStepsHeaderLbl');
export const dynVisualStatusBadge = document.getElementById('dynVisualStatusBadge');
export const dynTouchWrap = document.getElementById('dynTouchWrap');
export const dynStartsOnTouchCheck = document.getElementById('dynStartsOnTouchCheck');
export const dynBehindCheck = document.getElementById('dynBehindCheck');
export const dynActionWrap = document.getElementById('dynActionWrap');
export const dynActionableCheck = document.getElementById('dynActionableCheck');
export const dynReplacesCheck = document.getElementById('dynReplacesCheck');
export const dynTabVisualBtn = document.getElementById('dynTabVisualBtn');
export const dynTabCodeBtn = document.getElementById('dynTabCodeBtn');
export const dynVisualPane = document.getElementById('dynVisualPane');
export const dynCodePane = document.getElementById('dynCodePane');
export const dynMarkerRow = document.getElementById('dynMarkerRow');
export const dynMarkerSelect = document.getElementById('dynMarkerSelect');
export const dynLoopSecInput = document.getElementById('dynLoopSecInput');
export const dynPickPivotBtn = document.getElementById('dynPickPivotBtn');
export const dynPivotReadout = document.getElementById('dynPivotReadout');
export const dynActCelSelect = document.getElementById('dynActCelSelect');
export const dynActKindSelect = document.getElementById('dynActKindSelect');
export const dynActStartInput = document.getElementById('dynActStartInput');
export const dynActEndInput = document.getElementById('dynActEndInput');
export const dynActValInput = document.getElementById('dynActValInput');
export const dynAddActionBtn = document.getElementById('dynAddActionBtn');
export const dynStepsList = document.getElementById('dynStepsList');
export const dynCodeChips = document.getElementById('dynCodeChips');
export const dynScriptInput = document.getElementById('dynScriptInput');
export const dynScriptStatus = document.getElementById('dynScriptStatus');

export const openTextStudioBtn = document.getElementById('openTextStudioBtn');
export const textStudioModal = document.getElementById('textStudioModal');
export const textStudioTitle = document.getElementById('textStudioTitle');
export const textStudioCount = document.getElementById('textStudioCount');
export const closeTextStudioX = document.getElementById('closeTextStudioX');
export const closeTextStudioBtn = document.getElementById('closeTextStudioBtn');
export const textStudioInput = document.getElementById('textStudioInput');
export const textStudioPrevTitle = document.getElementById('textStudioPrevTitle');
export const textStudioPrevText = document.getElementById('textStudioPrevText');

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
    (loadingScreen && loadingScreen.classList.contains('open')) ||
    (welcomeOverlay && welcomeOverlay.classList.contains('open')) ||
    editorModal.classList.contains('open') ||
    (dynStudioModal && dynStudioModal.classList.contains('open')) ||
    (textStudioModal && textStudioModal.classList.contains('open')) ||
    worldsModal.classList.contains('open') ||
    (sceneryModal && sceneryModal.classList.contains('open')) ||
    typePickerModal.classList.contains('open') ||
    viewableModal.classList.contains('open')
  );
}
