/**
 * キャントストップ オンラインゲーム
 * -----------------------------
 * このスクリプトは、Firebase Firestore を利用したオンライン版キャントストップゲームの
 * フロントエンドロジックを処理します。主な機能は以下の通りです：
 * - Firebaseの初期化とFirestoreデータベースへの接続
 * - DOM要素の参照取得とイベントリスナーの設定
 * - ゲームの基本設定（最大プレイヤー数、トラック構成など）の定義
 * - グローバルなゲーム状態の管理（部屋ID、プレイヤーID、プレイヤーリストなど）
 * - ゲームボードの動的な描画
 * - 部屋の作成、参加、ゲーム開始といった部屋管理機能
 * - ダイスロール、組み合わせ選択、マーカー進行、ストップ、バストといったコアゲームロジック
 *   - 「ストップ」時には、そのターンの進行が「確定マーカー」として保存され、次回以降の進行の基点となる。
 *   - マーカーが重なる場合は、視認性向上のため表示位置をずらす。
 * - Firestoreとのリアルタイムデータ同期とUI更新
 * - プレイヤーへのメッセージ表示（情報、エラー、成功など）
 * - UI表示状態の制御（部屋管理画面、ゲーム画面など）
 */

// Firebase SDKの初期化とFirestoreインスタンスの取得
if (typeof firebase !== 'undefined' && typeof firebaseConfig !== 'undefined') {
    try {
        const app = firebase.initializeApp(firebaseConfig);
        var db = firebase.firestore(); // Firestoreデータベースインスタンス
        console.log("Firebase initialized successfully."); // Firebase初期化成功ログ
    } catch (e) {
        console.error("Firebase initialization failed: ", e);
        alert("Firebaseの初期化に失敗しました。設定を確認してください。");
    }
} else {
    console.error("Firebase SDK not loaded or firebaseConfig is not defined.");
    alert("Firebase SDKまたは設定が読み込まれていません。HTMLとfirebase-config.jsを確認してください。");
}

// --- DOM Element References ---
const roomManagementDiv = document.getElementById('room-management');
const hostNameInput = document.getElementById('host-name');
const createRoomButton = document.getElementById('create-room-btn');
const roomIdDisplay = document.getElementById('room-id-display');
const clientNameInput = document.getElementById('client-name');
const roomIdInput = document.getElementById('room-id-input');
const joinRoomButton = document.getElementById('join-room-btn');
const gameInfoDiv = document.getElementById('game-info');
const currentPlayerDisplay = document.getElementById('current-player-display');
const messageDisplay = document.getElementById('message-display');
const startGameButton = document.getElementById('start-game-btn');
const playerListAreaDiv = document.getElementById('player-list-area');
const playerListUl = document.getElementById('player-list');
const gamePlayAreaDiv = document.getElementById('game-play-area');
const gameBoardDiv = document.getElementById('game-board');
const diceAreaDiv = document.getElementById('dice-area');
const diceResultDisplay = document.getElementById('dice-result-display');
const rollDiceButton = document.getElementById('roll-dice-btn');
const actionAreaDiv = document.getElementById('action-area');
const diceCombinationChoiceArea = document.getElementById('dice-combination-choice-area');
const stopButton = document.getElementById('stop-btn');

// --- Game Configuration Constants ---
const MAX_PLAYERS = 4;
const MIN_PLAYERS_TO_START = 2;
const TRACK_CONFIG = {
    '2': 3, '3': 5, '4': 7, '5': 9, '6': 11, '7': 13,
    '8': 11, '9': 9, '10': 7, '11': 5, '12': 3
};
const PLAYER_COLORS = ['red', 'blue', 'green', 'yellow'];

// --- Global Game State Variables ---
let currentRoomId = null;
let localPlayerId = null;
let players = [];
let activePlayerId = null;
let tempMarkersOnBoard = {};
let claimedTracks = {};
let previousActivePlayerId = null;

// --- Function Definitions ---

/**
 * ゲームボードのHTML構造を動的に生成し描画します。
 */
function drawGameBoard() {
    if (!gameBoardDiv) {
        console.error("Game board element (#game-board) not found!");
        return;
    }
    gameBoardDiv.innerHTML = '';

    for (const trackNumber in TRACK_CONFIG) {
        if (TRACK_CONFIG.hasOwnProperty(trackNumber)) {
            const numCells = TRACK_CONFIG[trackNumber];
            const trackDiv = document.createElement('div');
            trackDiv.classList.add('track');
            trackDiv.dataset.trackNumber = trackNumber;

            const trackLabel = document.createElement('div');
            trackLabel.classList.add('track-label');
            trackLabel.textContent = trackNumber;
            trackDiv.appendChild(trackLabel);

            for (let i = 1; i <= numCells; i++) {
                const cellDiv = document.createElement('div');
                cellDiv.classList.add('cell');
                cellDiv.dataset.track = trackNumber;
                cellDiv.dataset.cellPosition = i;

                if (i === 1) {
                    cellDiv.classList.add('cant-stop-space');
                }
                if (i === numCells) {
                    cellDiv.classList.add('goal-line');
                }
                const markerContainer = document.createElement('div');
                markerContainer.classList.add('marker-container');
                cellDiv.appendChild(markerContainer);
                trackDiv.appendChild(cellDiv);
            }
            gameBoardDiv.appendChild(trackDiv);
        }
    }
}

/**
 * 新しいゲーム部屋を作成しFirestoreに保存。ホストとして参加しUI更新、監視開始。
 */
async function createRoom() {
    clearMessageDisplay();
    if (!hostNameInput) { console.error("#host-name input not found"); return; }
    const hostName = hostNameInput.value.trim();

    if (!hostName) {
        setDisplayMessage("あなたの名前（ホスト名）を入力してください。", "error");
        return;
    }
    if (typeof db === 'undefined') {
        setDisplayMessage("データベース接続エラー。", "error");
        return;
    }

    localPlayerId = generatePlayerId();
    currentRoomId = generateRoomId();
    let currentPlayerName = hostName;

    const playerObject = {
        id: localPlayerId,
        name: hostName,
        color: PLAYER_COLORS[0],
        joinOrder: 1,
        isHost: true,
        progressMarkers: {}
    };

    const roomData = {
        roomId: currentRoomId,
        hostName: hostName,
        hostId: localPlayerId,
        players: { [localPlayerId]: playerObject },
        status: "waiting",
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        maxPlayers: MAX_PLAYERS,
        activePlayerId: null,
        turnTemporaryMarkers: {},
        claimedColumns: {},
        turnDiceRoll: [],
        turnChosenSums: [],
        turnBusted: false,
        winnerId: null,
    };
    try {
        await db.collection('rooms').doc(currentRoomId).set(roomData);
        console.log(`Room created: ${currentRoomId} by ${localPlayerId}`);
        if(roomIdDisplay) roomIdDisplay.textContent = currentRoomId;

        showGameRelatedUI(true, "waiting");
        listenToRoomUpdates(currentRoomId);
        alert(`部屋が作成されました。部屋ID: ${currentRoomId}`);
    } catch (error) {
        console.error("Error creating room: ", error);
        setDisplayMessage("部屋作成エラー: " + error.message, "error");
        currentRoomId = null;
        localPlayerId = null;
    }
}

/**
 * 既存のゲーム部屋に参加しFirestore情報を更新。UI更新、監視開始。
 */
async function joinRoom() {
    clearMessageDisplay();
    if (!clientNameInput) { console.error("#client-name input not found"); return; }
    const clientName = clientNameInput.value.trim();

    if (!roomIdInput) { console.error("#room-id-input not found"); return; }
    const roomIdToJoin = roomIdInput.value.trim().toUpperCase();

    if (!clientName) {
        setDisplayMessage("あなたの名前（参加者名）を入力してください。", "error");
        return;
    }
    if (!roomIdToJoin) {
        setDisplayMessage("参加する部屋IDを入力してください。", "error");
        return;
    }
    if (typeof db === 'undefined') {
        setDisplayMessage("データベース接続エラー。", "error");
        return;
    }

    try {
        const roomRef = db.collection('rooms').doc(roomIdToJoin);
        const roomDoc = await roomRef.get();

        if (!roomDoc.exists) {
            setDisplayMessage(`部屋ID ${roomIdToJoin} が見つかりません。`, "error");
            return;
        }

        const roomData = roomDoc.data();
        const numPlayers = Object.keys(roomData.players).length;

        if (numPlayers >= (roomData.maxPlayers || MAX_PLAYERS)) {
            setDisplayMessage(`部屋 ${roomIdToJoin} は満員です。`, "error");
            return;
        }
        if (roomData.status !== "waiting") {
            setDisplayMessage(`部屋 ${roomIdToJoin} は現在参加できません（ゲーム中または終了）。`, "error");
            return;
        }
        if (Object.values(roomData.players).some(p => p.name === clientName)) {
            setDisplayMessage("その名前は既に使用されています。別の名前を入力してください。", "error");
            return;
        }

        localPlayerId = generatePlayerId();
        let currentPlayerName = clientName;
        const playerObject = {
            id: localPlayerId,
            name: clientName,
            color: PLAYER_COLORS[numPlayers % PLAYER_COLORS.length],
            joinOrder: numPlayers + 1,
            isHost: false,
            progressMarkers: {}
        };

        await roomRef.update({
            [`players.${localPlayerId}`]: playerObject
        });
        currentRoomId = roomIdToJoin;
        console.log(`${clientName} joined room: ${currentRoomId}`);
        alert(`部屋 ${currentRoomId} に参加しました。`);

        showGameRelatedUI(false, "waiting");
        listenToRoomUpdates(currentRoomId);
    } catch (error) {
        console.error("Error joining room: ", error);
        setDisplayMessage("部屋参加エラー: " + error.message, "error");
        localPlayerId = null;
        currentRoomId = null;
    }
}

/**
 * ゲームを開始 (ホストのみ)。Firestore状態を 'playing' にし、初期ターンプレイヤー設定。
 */
async function startGame() {
    clearMessageDisplay();
    if (typeof db === 'undefined' || !currentRoomId) {
        setDisplayMessage("データベースに接続されていないか、部屋が存在しません。", "error");
        return;
    }
    if (!localPlayerId) {
        setDisplayMessage("プレイヤー情報がありません。再度参加または作成してください。", "error");
        return;
    }
    const roomRef = db.collection('rooms').doc(currentRoomId);
    try {
        const roomDoc = await roomRef.get();
        if (!roomDoc.exists) {
            setDisplayMessage("部屋のデータが見つかりません。", "error");
            return;
        }
        const roomData = roomDoc.data();

        if (roomData.hostId !== localPlayerId) {
            setDisplayMessage("ホストプレイヤーのみがゲームを開始できます。", "error");
            return;
        }

        const numPlayers = Object.keys(roomData.players).length;
        if (numPlayers < MIN_PLAYERS_TO_START) {
            setDisplayMessage(`ゲームを開始するには最低${MIN_PLAYERS_TO_START}人のプレイヤーが必要です。現在${numPlayers}人です。`, "error");
            return;
        }

        let firstPlayerId = null;
        let minJoinOrder = Infinity;
        for (const pId in roomData.players) {
            if (roomData.players[pId].joinOrder < minJoinOrder) {
                minJoinOrder = roomData.players[pId].joinOrder;
                firstPlayerId = pId;
            }
        }

        if (!firstPlayerId) {
            setDisplayMessage("最初のプレイヤーを決定できませんでした。", "error");
            return;
        }

        await roomRef.update({
            status: "playing",
            activePlayerId: firstPlayerId,
            turnDiceRoll: [],
            turnTemporaryMarkers: {},
            turnChosenSums: [],
            turnBusted: false,
            claimedColumns: {},
            winnerId: null,
        });
        console.log("Game started! First turn:", firstPlayerId);
    } catch (error) {
        console.error("Error starting game: ", error);
        setDisplayMessage("ゲーム開始エラー: " + error.message, "error");
    }
}

/**
 * プレイヤーリストUIを更新。名前、色、占領列数、自分の名前や現ターンプレイヤーを強調。
 * @param {object|null} roomData - Firestoreの部屋データ。nullなら情報なし表示。
 */
function updatePlayersList(roomData) {
    if (!playerListUl) { console.warn("playerListUl not found."); return; }
    if (!roomData || !roomData.players) {
        playerListUl.innerHTML = '<li>参加者情報がありません。</li>';
        return;
    }
    playerListUl.innerHTML = '';

    const sortedPlayers = Object.values(roomData.players).sort((a, b) => a.joinOrder - b.joinOrder);

    sortedPlayers.forEach(p => {
        const li = document.createElement('li');

        const indicator = document.createElement('span');
        indicator.classList.add('player-color-indicator');
        const playerColorIndex = PLAYER_COLORS.indexOf(p.color);
        indicator.style.backgroundColor = playerColorIndex !== -1 ? PLAYER_COLORS[playerColorIndex] : (p.color || '#888');
        li.appendChild(indicator);

        const nameSpan = document.createElement('span');

        let claimedCount = 0;
        if (roomData.claimedColumns) {
            for (const col in roomData.claimedColumns) {
                if (roomData.claimedColumns[col] === p.id) {
                    claimedCount++;
                }
            }
        }

        nameSpan.textContent = `${p.name} (占領: ${claimedCount}列)`;

        if (p.id === localPlayerId) {
            li.classList.add('my-name');
        }
        li.appendChild(nameSpan);

        if (roomData.activePlayerId === p.id && roomData.status === 'playing') {
            li.classList.add('active-player');
        }

        playerListUl.appendChild(li);
    });
}

/**
 * 現在のターンプレイヤー名をUIに表示。自分のターンなら強調、ゲーム終了時は勝者表示。
 * @param {object|null} roomData - Firestoreの部屋データ。nullならクリア。
 */
function updateCurrentPlayerDisplay(roomData) {
    if (!currentPlayerDisplay) { console.warn("currentPlayerDisplay not found."); return; }
    if (!roomData) {
        currentPlayerDisplay.textContent = '-';
        currentPlayerDisplay.style.fontWeight = 'normal';
        currentPlayerDisplay.style.color = '';
        return;
    }

    if (roomData.status === 'finished') {
        const winner = roomData.players[roomData.winnerId];
        if(winner) {
            currentPlayerDisplay.innerHTML = `勝者: <strong style="color:${winner.color || PLAYER_COLORS[PLAYER_COLORS.indexOf(winner.color)] || '#000'};">${winner.name}</strong>`;
        } else {
            currentPlayerDisplay.textContent = 'ゲーム終了';
        }
        currentPlayerDisplay.style.fontWeight = 'bold';
        return;
    }

    if (roomData.activePlayerId && roomData.players && roomData.players[roomData.activePlayerId]) {
        const activeP = roomData.players[roomData.activePlayerId];
        currentPlayerDisplay.textContent = activeP.name;
        if (activeP.id === localPlayerId) {
            currentPlayerDisplay.textContent += " (あなたのターン)";
            currentPlayerDisplay.style.fontWeight = 'bold';
            const playerColor = PLAYER_COLORS[PLAYER_COLORS.indexOf(activeP.color)] || activeP.color || '#000';
            currentPlayerDisplay.style.color = playerColor;
        } else {
             currentPlayerDisplay.style.fontWeight = 'normal';
             currentPlayerDisplay.style.color = '';
        }
    } else {
        currentPlayerDisplay.textContent = (roomData.status === 'waiting') ? 'ゲーム開始前' : '次のプレイヤー...';
        currentPlayerDisplay.style.fontWeight = 'normal';
        currentPlayerDisplay.style.color = '';
    }
}

/**
 * ダイスロール結果をUIに表示。
 * @param {number[]} diceRolls - ダイスの目配列。空やnullならデフォルト表示。
 */
function updateDiceResultDisplay(diceRolls) {
    if (!diceResultDisplay) { console.warn("diceResultDisplay not found."); return; }
    diceResultDisplay.innerHTML = '';
    if (diceRolls && diceRolls.length > 0) {
        diceRolls.forEach(roll => {
            const diceValueSpan = document.createElement('span');
            diceValueSpan.classList.add('dice-value');
            diceValueSpan.textContent = roll;
            diceResultDisplay.appendChild(diceValueSpan);
        });
    } else {
        diceResultDisplay.textContent = '-';
    }
}

/**
 * ダイスを振る/続ける処理。Firestoreの部屋データを更新し結果を同期。
 */
async function rollDice() {
    clearMessageDisplay();
    if (typeof db === 'undefined' || !currentRoomId || !localPlayerId) {
        setDisplayMessage("ゲームに参加していません。", "error");
        return;
    }
    const roomRef = db.collection('rooms').doc(currentRoomId);
    try {
        const roomDoc = await roomRef.get();
        if (!roomDoc.exists) {
            setDisplayMessage("部屋のデータが見つかりません。", "error");
            return;
        }
        const roomData = roomDoc.data();

        if (roomData.status !== "playing") {
            setDisplayMessage("ゲームが進行中ではありません。", "info");
            return;
        }
        if (roomData.activePlayerId !== localPlayerId) {
            setDisplayMessage("あなたのターンではありません。", "info");
            return;
        }

        const updates = {};
        if (roomData.turnDiceRoll && roomData.turnDiceRoll.length > 0 &&
            roomData.turnChosenSums && roomData.turnChosenSums.length > 0 &&
            Object.keys(roomData.turnTemporaryMarkers || {}).length > 0 &&
            !roomData.turnBusted) {
            updates.turnDiceRoll = [];
            updates.turnChosenSums = [];
            updates.turnBusted = false;
             console.log("Continuing turn: Resetting dice and chosen sums for re-roll.");
        } else if (roomData.turnDiceRoll && roomData.turnDiceRoll.length > 0) {
             setDisplayMessage("既にダイスは振られています。組み合わせを選択するかストップしてください。", "info");
             return;
        }

        const newDiceResults = [];
        for (let i = 0; i < 4; i++) {
            newDiceResults.push(Math.floor(Math.random() * 6) + 1);
        }
        updates.turnDiceRoll = newDiceResults;
        if (!updates.turnChosenSums) updates.turnChosenSums = [];
        if (updates.turnBusted === undefined) updates.turnBusted = false;

        await roomRef.update(updates);
        console.log("Dice rolled/reset. Firestore updates:", updates);
    } catch (error) {
        console.error("Error in rollDice: ", error);
        setDisplayMessage("ダイス処理エラー: " + error.message, "error");
    }
}

/**
 * ダイスの目から可能なペア組み合わせを生成しUIに表示。選択でラベルに .selected 付与。
 * @param {number[]} dice - 4つのダイスの目の配列。
 */
function generateDiceCombinations(dice) {
    if (!dice || dice.length !== 4) {
        console.error("generateDiceCombinations: Invalid dice array provided.", dice);
        if (diceCombinationChoiceArea) {
            diceCombinationChoiceArea.innerHTML = '<p>ダイス情報が不正確です。</p>';
            diceCombinationChoiceArea.classList.remove('hidden');
        }
        return;
    }

    const allCombinationsInput = [
        [[dice[0], dice[1]], [dice[2], dice[3]]],
        [[dice[0], dice[2]], [dice[1], dice[3]]],
        [[dice[0], dice[3]], [dice[1], dice[2]]]
    ];

    const uniqueSumPairs = [];
    const seenPairKeys = new Set();

    allCombinationsInput.forEach(comboGroup => {
        const sum1 = comboGroup[0][0] + comboGroup[0][1];
        const sum2 = comboGroup[1][0] + comboGroup[1][1];

        const displayString = `(${comboGroup[0].join('+')}=${sum1} と ${comboGroup[1].join('+')}=${sum2})`;
        const value = [sum1, sum2];

        const keyForUniqueness = value.slice().sort((a,b)=>a-b).join(',');
        if (!seenPairKeys.has(keyForUniqueness)) {
            uniqueSumPairs.push({ display: displayString, value: value });
            seenPairKeys.add(keyForUniqueness);
        }
    });

    if (diceCombinationChoiceArea) {
        diceCombinationChoiceArea.innerHTML = '';
        if (uniqueSumPairs.length > 0) {
            uniqueSumPairs.forEach((combo, index) => {
                const label = document.createElement('label');
                const radio = document.createElement('input');
                radio.type = 'radio';
                radio.name = 'diceCombination';
                radio.value = index;
                radio.dataset.chosenSums = combo.value.join(',');

                radio.addEventListener('change', (event) => {
                    document.querySelectorAll('#dice-combination-choice-area label').forEach(lbl => lbl.classList.remove('selected'));
                    if (event.target.checked) {
                        event.target.parentElement.classList.add('selected');
                    }
                });

                label.appendChild(radio);
                label.append(` ${combo.display}`);
                diceCombinationChoiceArea.appendChild(label);
                diceCombinationChoiceArea.appendChild(document.createElement('br'));
            });

            const selectButton = document.createElement('button');
            selectButton.id = 'confirm-combination-btn';
            selectButton.textContent = 'この組み合わせで進む';
            selectButton.onclick = selectDiceCombination;
            diceCombinationChoiceArea.appendChild(selectButton);
        } else {
            diceCombinationChoiceArea.innerHTML = '<p>有効なダイスの組み合わせがありません。</p>';
            console.warn("No unique dice combinations to display for dice:", dice);
        }
        diceCombinationChoiceArea.classList.remove('hidden');
    }
}

/**
 * 選択されたダイス組み合わせに基づき一時マーカーを配置/進行。バスト処理も含む。
 * 結果はFirestoreに保存。
 */
async function selectDiceCombination() {
    clearMessageDisplay();
    if (typeof db === 'undefined' || !currentRoomId || !localPlayerId) {
        setDisplayMessage("ゲームに参加していません。", "error");
        return;
    }

    const selectedRadio = document.querySelector('input[name="diceCombination"]:checked');
    if (!selectedRadio) {
        setDisplayMessage("ダイスの組み合わせを選択してください。", "error");
        return;
    }

    const chosenSumsString = selectedRadio.dataset.chosenSums;
    const chosenSums = chosenSumsString.split(',').map(s => parseInt(s.trim()));

    if (!chosenSums || chosenSums.length !== 2) {
        console.error("Invalid chosen combination from radio dataset:", chosenSumsString);
        setDisplayMessage("選択された組み合わせが無効です。", "error");
        return;
    }

    const roomRef = db.collection('rooms').doc(currentRoomId);
    try {
        const roomDoc = await roomRef.get();
        if (!roomDoc.exists) throw new Error("Room data not found during combination selection!");

        let roomData = roomDoc.data();

        if (roomData.activePlayerId !== localPlayerId) { setDisplayMessage("あなたのターンではありません。", "info"); return; }
        if (!roomData.turnDiceRoll || roomData.turnDiceRoll.length === 0) { setDisplayMessage("まだダイスが振られていません。", "info"); return; }
        if (roomData.turnChosenSums && roomData.turnChosenSums.length > 0) { setDisplayMessage("既に組み合わせは選択済みです。", "info"); return; }

        let tempWorkMarkers = JSON.parse(JSON.stringify(roomData.turnTemporaryMarkers || {}));
        const claimedCols = roomData.claimedColumns || {};
        let progressedThisPair = false;
        let isBust = false;

        function attemptToAdvanceOnTrack(trackSum, currentTempMarkersState) {
            const trackSumStr = String(trackSum);
            if (trackSum < 2 || trackSum > 12) return false;
            if (claimedCols[trackSumStr] && claimedCols[trackSumStr] !== localPlayerId) return false;
            if (claimedCols[trackSumStr] && claimedCols[trackSumStr] === localPlayerId) return false;

            const currentTempPosOnTrack = currentTempMarkersState[trackSumStr];
            const playerProgressOnTrack = roomData.players[localPlayerId]?.progressMarkers?.[trackSumStr] || 0;

            let basePosition = playerProgressOnTrack;
            if (currentTempPosOnTrack) {
                basePosition = currentTempPosOnTrack;
            }

            if (basePosition >= TRACK_CONFIG[trackSumStr]) return false;

            const numTempMarkersCurrently = Object.keys(currentTempMarkersState).length;
            if (!currentTempMarkersState[trackSumStr] && numTempMarkersCurrently >= 3) {
                return false;
            }

            if (currentTempMarkersState[trackSumStr]) {
                currentTempMarkersState[trackSumStr]++;
            } else {
                currentTempMarkersState[trackSumStr] = (playerProgressOnTrack > 0 ? playerProgressOnTrack : 0) + 1;
            }
            return true;
        }

        if (attemptToAdvanceOnTrack(chosenSums[0], tempWorkMarkers)) {
            progressedThisPair = true;
        }
        if (attemptToAdvanceOnTrack(chosenSums[1], tempWorkMarkers)) {
            progressedThisPair = true;
        }

        if (!progressedThisPair) {
            isBust = true;
            console.log(`Player ${localPlayerId} busted. No valid moves for chosen sums: ${chosenSums.join(',')}`);
        }

        const updatesForFirestore = {
            turnChosenSums: chosenSums,
            turnTemporaryMarkers: isBust ? {} : tempWorkMarkers,
            turnBusted: isBust,
        };

        if (isBust) {
            updatesForFirestore.activePlayerId = getNextPlayerId(roomData);
            updatesForFirestore.turnDiceRoll = [];
            updatesForFirestore.turnChosenSums = [];
        }

        await roomRef.update(updatesForFirestore);
        console.log("Dice combination processed. Firestore updates:", updatesForFirestore);

    } catch (error) {
        console.error("Error in selectDiceCombination (advancing markers): ", error);
        setDisplayMessage("マーカー進行処理エラー: " + error.message, "error");
    }
}


/**
 * ボード上のマーカー表示を全体的に更新します。
 * 永続的な進捗マーカー、占領マーカー、現在アクティブなプレイヤーの一時マーカーを描画します。
 * マーカーの重なりを避けるため、オフセットクラスを適用します。
 * @param {object|null} roomData - Firestoreから取得した現在の部屋データ。nullの場合はマーカーをクリア。
 */
function updateBoardMarkers(roomData) {
    if (!gameBoardDiv) { console.error("gameBoardDiv not found in updateBoardMarkers"); return; }
    gameBoardDiv.querySelectorAll('.progress-marker, .claim-marker, .temp-marker').forEach(m => m.remove());

    if (!roomData) { return; }

    const getPlayerColorClass = (pId) => {
        if (roomData.players && roomData.players[pId]) {
            const player = roomData.players[pId];
            if (player.color) {
                const colorIndex = PLAYER_COLORS.indexOf(player.color);
                return colorIndex !== -1 ? `player${colorIndex}` : 'player-default';
            }
        }
        const playerFromArray = players.find(p => p.id === pId);
        if (playerFromArray && playerFromArray.color) {
            const colorIndex = PLAYER_COLORS.indexOf(playerFromArray.color);
            return colorIndex !== -1 ? `player${colorIndex}` : 'player-default';
        }
        return 'player-default';
    };

    // 描画順序: 1.確定マーカー -> 2.占領マーカー -> 3.一時マーカー (一時マーカーが最前面)

    // 1. 各プレイヤーの永続化された進捗マーカー (progressMarkers) を描画
    if (roomData.players) {
        for (const pId in roomData.players) {
            if (roomData.players.hasOwnProperty(pId)) {
                const player = roomData.players[pId];
                if (player.progressMarkers) {
                    const playerColorClass = getPlayerColorClass(player.id);
                    for (const trackNumStr in player.progressMarkers) {
                        if (player.progressMarkers.hasOwnProperty(trackNumStr)) {
                            if (roomData.claimedColumns && roomData.claimedColumns[trackNumStr]) continue;

                            const position = player.progressMarkers[trackNumStr];
                            const trackGoal = TRACK_CONFIG[trackNumStr];

                            if (position > 0 && position < trackGoal) {
                                const cellSelector = `.track[data-track-number="${trackNumStr}"] .cell[data-cell-position="${position}"] .marker-container`;
                                const markerContainer = gameBoardDiv.querySelector(cellSelector);
                                if (markerContainer) {
                                    const markerDiv = document.createElement('div');
                                    markerDiv.classList.add('progress-marker', playerColorClass);
                                    markerDiv.dataset.playerId = pId;

                                    const existingMarkersCount = markerContainer.children.length;
                                    markerDiv.classList.add(`marker-offset-${existingMarkersCount % 4}`);

                                    markerContainer.appendChild(markerDiv);
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // 2. 全プレイヤーの占領マーカーを描画 (claimedColumns に基づいて)
    if (roomData.claimedColumns) {
        for (const trackNumStr in roomData.claimedColumns) {
            if (roomData.claimedColumns.hasOwnProperty(trackNumStr)) {
                const pId = roomData.claimedColumns[trackNumStr];
                const claimedPlayerColorClass = getPlayerColorClass(pId);
                const goalPosition = TRACK_CONFIG[trackNumStr];

                const cellSelector = `.track[data-track-number="${trackNumStr}"] .cell[data-cell-position="${goalPosition}"] .marker-container`;
                const markerContainer = gameBoardDiv.querySelector(cellSelector);

                if (markerContainer) {
                    const claimMarkerDiv = document.createElement('div');
                    claimMarkerDiv.classList.add('claim-marker', claimedPlayerColorClass);
                    claimMarkerDiv.dataset.playerId = pId;

                    const existingMarkersCount = markerContainer.children.length;
                    claimMarkerDiv.classList.add(`marker-offset-${existingMarkersCount % 4}`);

                    markerContainer.appendChild(claimMarkerDiv);
                }
            }
        }
    }

    // 3. 現在のターンプレイヤーの一時マーカーを描画 (最前面に来るように最後に描画)
    if (roomData.activePlayerId && roomData.turnTemporaryMarkers) {
        const activePlayerColorClass = getPlayerColorClass(roomData.activePlayerId);
        for (const trackNumStr in roomData.turnTemporaryMarkers) {
            if (roomData.turnTemporaryMarkers.hasOwnProperty(trackNumStr)) {
                const position = roomData.turnTemporaryMarkers[trackNumStr];
                if (position > 0 && position <= TRACK_CONFIG[trackNumStr]) {
                    const cellSelector = `.track[data-track-number="${trackNumStr}"] .cell[data-cell-position="${position}"] .marker-container`;
                    const markerContainer = gameBoardDiv.querySelector(cellSelector);

                    if (markerContainer) {
                        const markerDiv = document.createElement('div');
                        markerDiv.classList.add('temp-marker', activePlayerColorClass);
                        markerDiv.dataset.playerId = roomData.activePlayerId;

                        const existingMarkersCount = markerContainer.children.length;
                        markerDiv.classList.add(`marker-offset-${existingMarkersCount % 4}`);

                        markerContainer.appendChild(markerDiv);
                    }
                }
            }
        }
    }
}

/**
 * 「ストップ」アクションを処理します。
 * 現在の一時マーカーを確定し、必要なら列を占領します。
 * プレイヤーの永続的な進捗 (progressMarkers) も更新します。
 * 勝利条件をチェックし、ゲームを終了するか次のプレイヤーにターンを移します。
 */
async function stopTurn() {
    clearMessageDisplay();
    if (typeof db === 'undefined' || !currentRoomId || !localPlayerId) {
        setDisplayMessage("ゲームに参加していません。", "error"); return;
    }

    const roomRef = db.collection('rooms').doc(currentRoomId);
    try {
        const roomDoc = await roomRef.get();
        if (!roomDoc.exists) throw new Error("Room data not found for stopTurn!");
        let roomData = roomDoc.data();

        if (roomData.activePlayerId !== localPlayerId) {
            setDisplayMessage("あなたのターンではありません。", "info"); return;
        }
        if (roomData.status !== "playing") {
            setDisplayMessage("ゲームは進行中ではありません。", "info"); return;
        }
        if (roomData.turnBusted) {
            setDisplayMessage("バストしています。ストップ操作は不要です。", "info"); return;
        }
        if (Object.keys(roomData.turnTemporaryMarkers || {}).length === 0 &&
            (!roomData.turnDiceRoll || roomData.turnDiceRoll.length === 0)) {
            setDisplayMessage("まずダイスを振ってください。", "info"); return;
        }
        if (roomData.turnDiceRoll && roomData.turnDiceRoll.length > 0 &&
           (!(roomData.turnChosenSums && roomData.turnChosenSums.length > 0) || Object.keys(roomData.turnTemporaryMarkers || {}).length === 0) ) {
            setDisplayMessage("ダイスの組み合わせを選びマーカーを進めてください。", "info"); return;
        }

        const playerObject = roomData.players[localPlayerId];
        if (!playerObject) {
            console.error("Player object not found for localPlayerId:", localPlayerId, "in roomData players:", roomData.players);
            setDisplayMessage("プレイヤーデータが見つかりません。エラーが発生しました。", "error");
            return;
        }
        let currentPlayerExistingProgress = playerObject.progressMarkers || {};
        let newPlayerProgressMarkers = JSON.parse(JSON.stringify(currentPlayerExistingProgress));

        // 一時マーカーの位置を永続的な進捗 (progressMarkers) として更新
        // この時点での turnTemporaryMarkers は、そのターンで到達した最終位置を示している
        if (roomData.turnTemporaryMarkers && typeof roomData.turnTemporaryMarkers === 'object') {
            for (const trackStr in roomData.turnTemporaryMarkers) {
                if (roomData.turnTemporaryMarkers.hasOwnProperty(trackStr)) {
                    const currentTempPosition = roomData.turnTemporaryMarkers[trackStr];
                    // そのターンの進行で到達した位置を永続マーカーとして記録
                    newPlayerProgressMarkers[trackStr] = currentTempPosition;
                }
            }
        }

        let updatedClaimedColumns = { ...(roomData.claimedColumns || {}) };
        // 占領列の処理 - newPlayerProgressMarkers (つまり、このターンで確定した最終位置) を参照して占領を決定
        for (const colStr in newPlayerProgressMarkers) {
            const position = newPlayerProgressMarkers[colStr];
            const trackGoal = TRACK_CONFIG[colStr];
            if (position >= trackGoal && !updatedClaimedColumns[colStr]) {
                updatedClaimedColumns[colStr] = localPlayerId;
            }
        }

        let playerOccupiedCount = 0;
        // updatedClaimedColumns を基に現在のプレイヤーの総占領列数を再計算
        for (const col in updatedClaimedColumns) {
            if (updatedClaimedColumns[col] === localPlayerId) {
                playerOccupiedCount++;
            }
        }

        const updates = {
            claimedColumns: updatedClaimedColumns,
            turnTemporaryMarkers: {}, // ストップしたので一時マーカーはクリア
            turnDiceRoll: [],
            turnChosenSums: [],
            turnBusted: false,
            [`players.${localPlayerId}.progressMarkers`]: newPlayerProgressMarkers, // 更新された永続マーカーを保存
            activePlayerId: getNextPlayerId(roomData),
        };

        if (playerOccupiedCount >= 3) {
            updates.status = "finished";
            updates.winnerId = localPlayerId;
            console.log(`Player ${localPlayerId} wins with ${playerOccupiedCount} columns!`);
        }

        await roomRef.update(updates);
        console.log("Turn stopped. Firestore updated with progressMarkers. Next player:", updates.activePlayerId);

    } catch (error) {
        console.error("Error stopping turn: ", error);
        setDisplayMessage("ストップ処理エラー: " + error.message, "error");
    }
}

/**
 * 次のターンプレイヤーのIDを決定します。プレイヤーリストを参加順にソートして次のプレイヤーを選択します。
 * @param {object} roomData - 現在の部屋データ。`players` と `activePlayerId` を含みます。
 * @returns {string|null} 次のプレイヤーのID。見つからない場合はnull、またはエラーを投げるか、最初のプレイヤーを返すなどのフォールバック。
 */
function getNextPlayerId(roomData) {
    if (!roomData || !roomData.players || !roomData.activePlayerId) {
        console.warn("Cannot get next player ID: roomData, players, or activePlayerId is missing.", roomData);
        const playerKeys = Object.keys(roomData.players || {});
        return playerKeys.length > 0 ? playerKeys[0] : null;
    }
    const playerArray = Object.values(roomData.players).sort((a, b) => a.joinOrder - b.joinOrder);
    if (playerArray.length === 0) return null;

    const currentIndex = playerArray.findIndex(p => p.id === roomData.activePlayerId);
    if (currentIndex === -1) {
        console.warn("Current active player not found in sorted player list. Defaulting to first player.");
        return playerArray[0].id;
    }
    return playerArray[(currentIndex + 1) % playerArray.length].id;
}


// --- イベントリスナー設定 ---
if (createRoomButton) createRoomButton.addEventListener('click', createRoom);
if (joinRoomButton) joinRoomButton.addEventListener('click', joinRoom);
if (startGameButton) startGameButton.addEventListener('click', startGame);
if (rollDiceButton) rollDiceButton.addEventListener('click', rollDice);
if (stopButton) stopButton.addEventListener('click', stopTurn);


// --- ヘルパー関数 (ID生成、UI表示制御) ---
/**
 * ランダムな一意のプレイヤーIDを生成します。
 * @returns {string} 生成されたプレイヤーID。
 */
function generatePlayerId() {
    return Math.random().toString(36).substr(2, 9);
}
/**
 * ランダムな部屋IDを生成します (英大文字と数字)。
 * @returns {string} 生成された部屋ID。
 */
function generateRoomId() {
    return Math.random().toString(36).substr(2, 6).toUpperCase();
}

/**
 * ゲーム関連のUIセクション（ゲーム情報、プレイヤーリスト、ゲームプレイエリア）の表示/非表示を制御します。
 * @param {boolean} isHost - 現在のプレイヤーがホストであるかを示すフラグ。
 * @param {string} [roomStatus="waiting"] - 現在の部屋のステータス ('waiting', 'playing', 'finished')。
 */
function showGameRelatedUI(isHost, roomStatus = "waiting") {
    const gamePlayArea = document.getElementById('game-play-area');

    if (roomManagementDiv) roomManagementDiv.classList.add('hidden');

    if (gameInfoDiv) gameInfoDiv.classList.remove('hidden');
    if (playerListAreaDiv) playerListAreaDiv.classList.remove('hidden');

    if (gamePlayArea) {
        if (roomStatus === "playing" || roomStatus === "finished") {
            gamePlayArea.classList.remove('hidden');
        } else {
            gamePlayArea.classList.add('hidden');
        }
    }

    if (startGameButton) {
        if (isHost && roomStatus === "waiting") {
            startGameButton.classList.remove('hidden');
        } else {
            startGameButton.classList.add('hidden');
        }
    }
}
/**
 * 部屋管理UIを表示し、他のゲーム関連UIを非表示にします。
 * メッセージ表示やボタンの状態も初期化します。
 */
function showRoomManagementUI() {
    const gamePlayArea = document.getElementById('game-play-area');

    if (roomManagementDiv) roomManagementDiv.classList.remove('hidden');

    if (gameInfoDiv) gameInfoDiv.classList.add('hidden');
    if (playerListAreaDiv) playerListAreaDiv.classList.add('hidden');
    if (gamePlayArea) gamePlayArea.classList.add('hidden');

    if (startGameButton) startGameButton.classList.add('hidden');
    if (rollDiceButton) rollDiceButton.disabled = true;
    if (stopButton) stopButton.disabled = true;
    if (roomIdDisplay) roomIdDisplay.textContent = '';
    if (messageDisplay) {
        setDisplayMessage('部屋を作成するか、IDを入力して参加してください。', 'info');
    }
}


// --- DOMContentLoaded Initializer ---
// DOMの読み込み完了後に、ゲームボードの初期描画とUIの初期状態設定、入力フィールドへのイベントリスナー設定を行います。
document.addEventListener('DOMContentLoaded', () => {
    drawGameBoard();
    showRoomManagementUI();

    const inputsToClearMessage = [hostNameInput, clientNameInput, roomIdInput];
    inputsToClearMessage.forEach(input => {
        if (input) {
            input.addEventListener('input', clearMessageDisplay);
        }
    });
    console.log("DOM fully loaded and game initialized.");
});

// --- Message Display Helper Functions ---
/**
 * `messageDisplay` DOM要素の内容をクリアし、スタイルをデフォルト（情報メッセージ）に戻します。
 */
function clearMessageDisplay() {
    if (messageDisplay) {
        messageDisplay.textContent = '';
        messageDisplay.className = 'info';
    }
}
/**
 * `messageDisplay` DOM要素に指定されたメッセージとタイプ（スタイル）を設定します。
 * @param {string} message - 表示するメッセージ文字列。
 * @param {'info' | 'success' | 'error'} [type='info'] - メッセージのタイプ。CSSクラス名に対応します。
 */
function setDisplayMessage(message, type = 'info') {
    if (messageDisplay) {
        messageDisplay.textContent = message;
        messageDisplay.className = type;
    }
}


// --- Firestore Realtime Listener Setup ---
/**
 * 指定された部屋IDのFirestoreドキュメントの変更をリアルタイムで監視します。
 * データが変更されるたびに、グローバル変数を更新し、関連するUI更新関数を呼び出して画面を最新の状態に保ちます。
 * @param {string} roomId - 監視対象の部屋ID。
 */
let roomUnsubscribe = null;
function listenToRoomUpdates(roomId) {
    if (typeof db === 'undefined') {
        console.error("Firestore (db) is not initialized. Cannot listen to room updates.");
        setDisplayMessage("データベース接続エラー。", "error");
        return;
    }
    if (roomUnsubscribe) {
        roomUnsubscribe();
    }

    previousActivePlayerId = activePlayerId;
    currentRoomId = roomId;


    roomUnsubscribe = db.collection('rooms').doc(roomId)
        .onSnapshot((doc) => {
            if (doc.exists) {
                const roomData = doc.data();

                // グローバル変数の更新
                players = Object.values(roomData.players || {}).sort((a,b) => a.joinOrder - b.joinOrder);
                activePlayerId = roomData.activePlayerId;
                claimedTracks = roomData.claimedColumns || {};
                tempMarkersOnBoard = roomData.turnTemporaryMarkers || {};

                // UI更新
                updatePlayersList(roomData);
                updateCurrentPlayerDisplay(roomData);
                updateBoardMarkers(roomData);
                updateDiceResultDisplay(roomData.turnDiceRoll);
                updateMessageDisplay(roomData);

                const isMyTurn = roomData.activePlayerId === localPlayerId;

                // ゲーム状態に応じたUI制御
                if (roomData.status === 'playing') {
                    showGameRelatedUI(roomData.hostId === localPlayerId, roomData.status);
                    if (startGameButton) startGameButton.classList.add('hidden');

                    const diceRolled = roomData.turnDiceRoll && roomData.turnDiceRoll.length > 0;
                    const combinationChosen = roomData.turnChosenSums && roomData.turnChosenSums.length > 0;
                    const isGamePlaying = roomData.status === 'playing'; // playing状態か
                    const diceRolled = roomData.turnDiceRoll && roomData.turnDiceRoll.length > 0; // ダイスロール済みか
                    const combinationChosen = roomData.turnChosenSums && roomData.turnChosenSums.length > 0; // 組み合わせ選択済みか
                    const isBustedForThisTurn = roomData.turnBusted; // ★現在のターンのプレイヤーがバストしているか
                    const tempMarkersExist = Object.keys(roomData.turnTemporaryMarkers || {}).length > 0; // 一時マーカーが存在するか

                    // 「ダイスを振る」/「続ける」ボタンの制御
                    if (rollDiceButton) {
                        // 条件1: 自分のターン、プレイ中、バスト状態ではなく、まだダイスを振っていない → 「ダイスを振る」を有効化
                        const canMakeFirstRoll = isMyTurn && isGamePlaying && !isBustedForThisTurn && !diceRolled;
                        // 条件2: 自分のターン、プレイ中、バスト状態ではなく、ダイスを振り、組み合わせも選び、一時マーカーもある → 「続ける」を有効化
                        const canContinue = isMyTurn && isGamePlaying && !isBustedForThisTurn && diceRolled && combinationChosen && tempMarkersExist;

                        if (canMakeFirstRoll) {
                            rollDiceButton.disabled = false;
                            rollDiceButton.textContent = 'ダイスを振る';
                        } else if (canContinue) {
                            rollDiceButton.disabled = false;
                            rollDiceButton.textContent = '続ける';
                        } else {
                            // 上記のいずれでもない場合は無効化
                            rollDiceButton.disabled = true;
                            // ボタンのテキストを状況に応じて設定
                            if (!isMyTurn || !isGamePlaying) { // 自分のターンでない、またはゲーム中でない
                                 rollDiceButton.textContent = 'ダイスを振る';
                            } else if (isMyTurn && isGamePlaying && isBustedForThisTurn) { // 自分のターンでバストしている
                                rollDiceButton.textContent = 'バストしました';
                            } else if (isMyTurn && isGamePlaying && diceRolled && !combinationChosen) { // 組み合わせ選択待ち
                                 rollDiceButton.textContent = '組み合わせ選択中';
                            } else { // その他の自分のターンだが操作できない状態
                                 rollDiceButton.textContent = 'ダイスを振る'; // デフォルトに戻す
                            }
                        }
                    }

                    // 「ストップ」ボタンの制御
                    if (stopButton) {
                        // ストップ可能な条件: 自分のターン、プレイ中、バストしてない、ダイスロール済み、組み合わせ選択済み、一時マーカーが存在
                        const canStop = isMyTurn && isGamePlaying && !isBustedForThisTurn && diceRolled && combinationChosen && tempMarkersExist;
                        stopButton.disabled = !canStop;
                    }

                    // ダイス組み合わせ選択エリアの表示制御
                    if (diceCombinationChoiceArea) {
                        // 表示条件: 自分のターン、プレイ中、ダイスロール済み、バストしてない、かつ組み合わせ未選択
                        const showCombinations = isMyTurn && isGamePlaying && diceRolled && !isBustedForThisTurn && !combinationChosen;

                        if (showCombinations) {
                            diceCombinationChoiceArea.innerHTML = '';
                            generateDiceCombinations(roomData.turnDiceRoll);
                            diceCombinationChoiceArea.classList.remove('hidden');
                        } else {
                            diceCombinationChoiceArea.classList.add('hidden');
                            // 自分のターンで組み合わせ選択済みの場合、選択肢は表示し操作不可にする
                            if (isMyTurn && isGamePlaying && diceRolled && !isBustedForThisTurn && combinationChosen) {
                                // generateDiceCombinationsを再度呼ばないように、既存の要素を無効化する
                                // diceCombinationChoiceArea.innerHTML が空でなければ（つまり要素が描画されていれば）無効化
                                if(diceCombinationChoiceArea.innerHTML !== '' && diceCombinationChoiceArea.querySelector('input')){
                                   diceCombinationChoiceArea.querySelectorAll('input, button').forEach(el => el.disabled = true);
                                   diceCombinationChoiceArea.classList.remove('hidden');
                                } else if (showCombinations) {
                                    // このケースは上の if (showCombinations) で処理されるため、ここには来ないはず
                                    // もしinnerHTMLが空だがcombinationChosenがtrueという稀なケースなら再描画＆無効化が必要
                                    generateDiceCombinations(roomData.turnDiceRoll);
                                    diceCombinationChoiceArea.querySelectorAll('input, button').forEach(el => el.disabled = true);
                                    diceCombinationChoiceArea.classList.remove('hidden');
                                }
                            }
                        }
                    }
                } else if (roomData.status === 'waiting') {
                    showGameRelatedUI(roomData.hostId === localPlayerId, roomData.status);
                    const amIHost = roomData.hostId === localPlayerId;
                    const numPlayers = Object.keys(roomData.players || {}).length;
                    if (startGameButton) {
                        startGameButton.disabled = !(amIHost && numPlayers >= MIN_PLAYERS_TO_START && numPlayers <= MAX_PLAYERS);
                    }
                     if (diceCombinationChoiceArea) diceCombinationChoiceArea.classList.add('hidden');
                     if (rollDiceButton) rollDiceButton.disabled = true;
                     if (stopButton) stopButton.disabled = true;

                } else if (roomData.status === 'finished') {
                    showGameRelatedUI(roomData.hostId === localPlayerId, roomData.status);
                    if (rollDiceButton) rollDiceButton.disabled = true;
                    if (stopButton) stopButton.disabled = true;
                    if (diceCombinationChoiceArea) diceCombinationChoiceArea.classList.add('hidden');
                }
            } else {
                console.warn("Room data no longer exists or access denied for room:", currentRoomId);
                alert("部屋の情報が見つからないか、アクセスが拒否されました。ロビーに戻ります。");
                if (roomUnsubscribe) {
                    roomUnsubscribe();
                    roomUnsubscribe = null;
                }
                showRoomManagementUI();
                currentRoomId = null;
                localPlayerId = null;
                players = []; activePlayerId = null; claimedTracks = {}; tempMarkersOnBoard = {};
                updatePlayersList(null);
                updateCurrentPlayerDisplay(null);
                updateBoardMarkers(null);
                updateDiceResultDisplay([]);
                setDisplayMessage("部屋から退出しました。または部屋が無効になりました。", "info");
            }
        }, (error) => {
            console.error(`Error listening to room ${currentRoomId} updates: `, error);
            setDisplayMessage("部屋の更新受信エラー: " + error.message, "error");
            alert("部屋の情報の受信に失敗しました。ページをリロードしてみてください。エラー: " + error.message);
        });
}
/**
 * ゲームの現在の状況に基づいてメッセージエリア (`messageDisplay`) を更新します。
 * ターン情報、バスト、勝利などをユーザーに通知します。
 * @param {object|null} roomData - Firestoreから取得した現在の部屋データ。nullの場合はデフォルトメッセージ表示。
 */
function updateMessageDisplay(roomData) {
    if (!messageDisplay) { console.warn("messageDisplay element not found."); return; }
    if (!roomData) {
        setDisplayMessage('メッセージはありません。', 'info');
        return;
    }

    const isMyTurn = roomData.activePlayerId === localPlayerId;

    if (roomData.status === 'finished') {
        const winner = roomData.players[roomData.winnerId];
        if (winner) {
            messageDisplay.innerHTML = `ゲーム終了！ <strong style="color:${winner.color || PLAYER_COLORS[PLAYER_COLORS.indexOf(winner.color)] || '#000'};">${winner.name}</strong> さんの勝利です！ 🎉`;
            setDisplayMessage(messageDisplay.textContent, 'success');
        } else {
            setDisplayMessage("ゲーム終了！", 'info');
        }
        return;
    }

    // バストメッセージ表示の改善: バストしたプレイヤーIDをFirestoreに短時間記録するか、
    // previousActivePlayerId をより確実に使う必要がある。
    // 現状の previousActivePlayerId は listenToRoomUpdates の冒頭で更新されるため、
    // バスト処理で activePlayerId が変更された「後」の onSnapshot では、
    // previousActivePlayerId は「バストしたプレイヤー」ではなく「バストしたプレイヤーの前のプレイヤー」を指す可能性がある。
    // → バストメッセージは、バストが Firestore に書き込まれた際の turnBusted: true をトリガーに表示するのが良い。
    //   その際、メッセージを出すべき対象プレイヤーは、Firestore のデータだけでは特定しにくい場合がある。
    //   クライアント側で「自分が直前のFirestore更新でバスト状態になった」ことを検知する方がシンプルかもしれない。
    //   ここでは、roomData.turnBusted が true で、かつ activePlayerId が自分ではない（＝ターンが移った後）場合、
    //   previousActivePlayerId がバストしたプレイヤーだと期待してメッセージを出す。

    if (roomData.turnBusted) { // 誰かがバストしたという事実に基づいてメッセージを出す
        // activePlayerIdは既に次のプレイヤーに移っているはずなので、previousActivePlayerIdがバストしたプレイヤー
        const bustedPlayerObject = roomData.players[previousActivePlayerId];

        if (bustedPlayerObject && previousActivePlayerId === localPlayerId && !isMyTurn) {
            // 自分がバストして、既にターンが移っている場合。(この条件はisMyTurnがfalseなので通常はここに来ない)
            // selectDiceCombinationでバスト時に自分のメッセージは既に出しているはず。
            // ここでは他のプレイヤー向けのメッセージを主に考慮。
             setDisplayMessage("あなたがバストしました。次のプレイヤーの番です。", "error"); // 自分への最終通知
        } else if (bustedPlayerObject && previousActivePlayerId !== localPlayerId ) {
            // 他の誰かがバストした。
            setDisplayMessage(`${bustedPlayerObject.name}さんがバストしました。`, "error");
        } else if (isMyTurn && roomData.turnTemporaryMarkers && Object.keys(roomData.turnTemporaryMarkers).length === 0) {
            // isBust で activePlayerId が変更され、新しいターンプレイヤーになった場合、
            // この分岐は通常通らないはず（turnBusted:false で新しいターンが始まるため）。
            // もし自分のターンで turnBusted が true のままなら（例えば selectDiceCombination の書き込みが部分的だったなど）、
            // このメッセージが表示される。
            setDisplayMessage("バストしました！", "error");
        } else if (!bustedPlayerObject && previousActivePlayerId) {
             // previousActivePlayerId はあるが、そのプレイヤー情報が roomData.players にない場合（ほぼありえない）
             setDisplayMessage(`プレイヤー ${previousActivePlayerId.substring(0,4)}.. さんがバストしました。`, "error");
        } else {
            // バストしたが、詳細不明な場合
            setDisplayMessage("バストが発生しました。", "error");
        }
        return;
    }

    if (roomData.status === 'playing') {
        if (isMyTurn) {
            if (roomData.turnDiceRoll && roomData.turnDiceRoll.length > 0) {
                if (roomData.turnChosenSums && roomData.turnChosenSums.length > 0) {
                    setDisplayMessage("マーカーを進めました。「続ける」か「ストップ」を選択してください。", "info");
                } else {
                    setDisplayMessage("ダイスを振りました。組み合わせを選択してください。", "info");
                }
            } else {
                setDisplayMessage("あなたのターンです。ダイスを振ってください。", "info");
            }
        } else {
            const activeP = roomData.players[roomData.activePlayerId];
            setDisplayMessage(activeP ? `${activeP.name}さんのターンです。` : "ゲームプレイ中...", "info");
        }
    } else if (roomData.status === 'waiting') {
        setDisplayMessage("プレイヤーの参加を待っています...", "info");
    } else {
        setDisplayMessage('ゲームの準備ができました。', 'info');
    }
}

[end of script.js]
