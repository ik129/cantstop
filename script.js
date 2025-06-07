/**
 * キャントストップ オンラインゲーム
 * -----------------------------
 * Firebase Firestore を利用したオンライン版キャントストップゲームのフロントエンドロジック。
 * 主な機能：
 * - Firebase初期化、Firestore接続
 * - DOM参照、イベントリスナー設定
 * - ゲーム基本設定 (最大プレイヤー数、トラック構成等)
 * - グローバルゲーム状態管理 (部屋ID、プレイヤーID等)
 * - ゲームボード描画
 * - 部屋管理: 部屋作成・参加 (ロビーでの部屋ID表示含む)、ゲーム開始
 * - コアゲームロジック:
 *   - ダイスロール (4ダイス)
 *   - ダイス組み合わせ選択 (2つの合計値を形成)
 *   - 一時マーカー (最大3つ) の配置・進行
 *     - プレイヤーの既存「確定マーカー」(progressMarkers) を考慮して開始位置を決定
 *     - 3つ目の一時マーカー配置選択: 一時マーカーが2つあり、選択したダイスペアの合計値S1, S2が両方とも新規トラックの場合、プレイヤーにS1かS2どちらに配置するか選択させる
 *   - 「ストップ」: 一時マーカーの位置を確定マーカーとして保存、次回そこから進行再開可。ゴールならトラック占領
 *   - 「続ける」: 再度ダイスロール
 *   - バスト条件:
 *     - ダイスロール後、進行可能な有効な組み合わせがない場合 (自動バスト)
 *     - 「続ける」を選択後、選択した組み合わせで一時マーカーを進行できない場合
 * - Firestoreリアルタイムデータ同期によるUI更新 (他プレイヤーの行動反映)
 * - プレイヤーへのメッセージ表示 (情報、エラー、成功、バスト通知等)
 * - UI表示状態制御 (部屋管理画面、ゲーム画面、各種ボタンの有効/無効化)
 */

// Firebase SDKの初期化とFirestoreインスタンスの取得
if (typeof firebase !== 'undefined' && typeof firebaseConfig !== 'undefined') {
    try {
        firebase.initializeApp(firebaseConfig);
        var db = firebase.firestore(); // Firestoreデータベースインスタンス
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
const placeThirdMarkerChoiceArea = document.getElementById('place-third-marker-choice-area'); // Added
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

/** ゲームボードのHTML構造を動的に生成し描画します。*/
function drawGameBoard() { /* ... (実装は変更なし) ... */
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

/** 新しいゲーム部屋を作成しFirestoreに保存。ホストとして参加しUI更新、監視開始。*/
async function createRoom() { /* ... (実装は変更なし, progressMarkers初期化は維持) ... */
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

    const playerObject = {
        id: localPlayerId,
        name: hostName,
        color: PLAYER_COLORS[0],
        joinOrder: 1,
        isHost: true,
        progressMarkers: {} // プレイヤーごとの確定マーカー(中間マーカー)の状態
    };

    const roomData = {
        roomId: currentRoomId,
        hostName: hostName,
        hostId: localPlayerId,
        players: { [localPlayerId]: playerObject },
        status: "waiting", // "waiting", "playing", "finished"
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        maxPlayers: MAX_PLAYERS,
        activePlayerId: null,      // 現在のターンプレイヤーID
        turnTemporaryMarkers: {},  // 現在のターンのアクティブプレイヤーの一時マーカー { trackNumStr: position }
        claimedColumns: {},        // 各トラックを占領したプレイヤーID { trackNumStr: playerId }
        turnDiceRoll: [],          // 現在のターンのダイスロール結果 [d1, d2, d3, d4]
        turnChosenSums: [],        // 現在のターンで選択されたダイスの合計値ペア [sum1, sum2]
        turnBusted: false,         // 現在のターンプレイヤーがバストしたか
        winnerId: null,            // ゲーム勝者ID
    };
    try {
        await db.collection('rooms').doc(currentRoomId).set(roomData);
        // roomIdDisplay は showGameRelatedUI 内で更新される
        showGameRelatedUI(true, "waiting");
        listenToRoomUpdates(currentRoomId);
        alert(`部屋が作成されました。部屋ID: ${currentRoomId}`);
    } catch (error) {
        console.error("Error creating room: ", error);
        setDisplayMessage("部屋作成エラー: " + error.message, "error");
        if(roomIdDisplay) roomIdDisplay.textContent = '';
        currentRoomId = null;
        localPlayerId = null;
    }
}

/** 既存のゲーム部屋に参加しFirestore情報を更新。UI更新、監視開始。*/
async function joinRoom() { /* ... (実装は変更なし, progressMarkers初期化は維持) ... */
    clearMessageDisplay();
    if (!clientNameInput) { console.error("#client-name input not found"); return; }
    const clientName = clientNameInput.value.trim();

    if (!roomIdInput) { console.error("#room-id-input input not found"); return; }
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
        const playerObject = {
            id: localPlayerId,
            name: clientName,
            color: PLAYER_COLORS[numPlayers % PLAYER_COLORS.length],
            joinOrder: numPlayers + 1,
            isHost: false,
            progressMarkers: {} // プレイヤーごとの確定マーカー(中間マーカー)の状態
        };

        await roomRef.update({
            [`players.${localPlayerId}`]: playerObject
        });
        currentRoomId = roomIdToJoin;
        // roomIdDisplay は showGameRelatedUI 内で更新される
        alert(`部屋 ${currentRoomId} に参加しました。`);

        showGameRelatedUI(false, "waiting");
        listenToRoomUpdates(currentRoomId);
    } catch (error) {
        console.error("Error joining room: ", error);
        setDisplayMessage("部屋参加エラー: " + error.message, "error");
        if(roomIdDisplay) roomIdDisplay.textContent = '';
        localPlayerId = null;
        currentRoomId = null;
    }
}

/** ゲームを開始 (ホストのみ)。Firestore状態を 'playing' にし、初期ターンプレイヤー設定。*/
async function startGame() { /* ... (実装は変更なし) ... */
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
        // UI更新は listenToRoomUpdates が担当
    } catch (error) {
        console.error("Error starting game: ", error);
        setDisplayMessage("ゲーム開始エラー: " + error.message, "error");
    }
}

/** プレイヤーリストUIを更新。名前、色、占領列数、自分の名前や現ターンプレイヤーを強調。
 * @param {object|null} roomData - Firestoreの部屋データ。nullなら情報なし表示。
 */
function updatePlayersList(roomData) { /* ... (実装は変更なし) ... */
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

/** 現在のターンプレイヤー名をUIに表示。自分のターンなら強調、ゲーム終了時は勝者表示。
 * @param {object|null} roomData - Firestoreの部屋データ。nullならクリア。
 */
function updateCurrentPlayerDisplay(roomData) { /* ... (実装は変更なし) ... */
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

/** ダイスロール結果をUIに表示。
 * @param {number[]} diceRolls - ダイスの目配列。空やnullならデフォルト表示。
 */
function updateDiceResultDisplay(diceRolls) { /* ... (実装は変更なし) ... */
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

/** ダイスを振る/続ける処理。Firestoreの部屋データを更新し結果を同期。*/
async function rollDice() { /* ... (実装は変更なし - 自動バスト判定はここに追加済み) ... */
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
        } else if (roomData.turnDiceRoll && roomData.turnDiceRoll.length > 0) {
             setDisplayMessage("既にダイスは振られています。組み合わせを選択するかストップしてください。", "info");
             return;
        }

        // 新しいダイスロール結果を生成
        const newDiceResults = [];
        for (let i = 0; i < 4; i++) {
            newDiceResults.push(Math.floor(Math.random() * 6) + 1);
        }
        updates.turnDiceRoll = newDiceResults;
        if (!updates.turnChosenSums) updates.turnChosenSums = []; // Ensure field exists
        if (updates.turnBusted === undefined) updates.turnBusted = false; // Ensure field exists

        await roomRef.update(updates); // ダイスロール結果をFirestoreに保存

        // === 自動バスト判定 ===
        // ダイスロール後、有効な進行手があるか確認するために最新の部屋データを取得
        const currentRoomDocAfterRoll = await roomRef.get();
        if (!currentRoomDocAfterRoll.exists) throw new Error("Room data vanished after dice roll!");
        const currentRoomDataForBustCheck = currentRoomDocAfterRoll.data();

        // 生成可能な全てのダイス合計値ペアを取得
        const possibleSumPairs = generatePossibleSumPairs(currentRoomDataForBustCheck.turnDiceRoll);
        let canAnyPairAdvance = false;
        // いずれかのペアで進行可能かチェック
        for (const pair of possibleSumPairs) {
            if (canPlayerAdvanceWithPair(pair, currentRoomDataForBustCheck, localPlayerId)) {
                canAnyPairAdvance = true; // 進行可能な手が見つかった
                break;
            }
        }

        // 進行可能な手が一つもなければ自動的にバスト
        if (!canAnyPairAdvance && currentRoomDataForBustCheck.turnDiceRoll.length > 0) {
            setDisplayMessage("進める組み合わせがありません。バストしました！", "error");
            const bustUpdates = { // バスト時のFirestore更新内容
                activePlayerId: getNextPlayerId(currentRoomDataForBustCheck), // 次のプレイヤーへターン移行
                turnDiceRoll: [],
                turnChosenSums: [],
                turnTemporaryMarkers: {}, // 一時マーカーリセット
                turnBusted: false,        // 次のターンのためにリセット (このターンのバスト状態はメッセージで表示)
            };
            await roomRef.update(bustUpdates);
        }
        // 自動バストでない場合、UIは listenToRoomUpdates によってダイス組み合わせ選択状態に更新される
    } catch (error) {
        console.error("Error in rollDice or auto-bust check: ", error);
        setDisplayMessage("ダイス処理または自動バスト判定エラー: " + error.message, "error");
    }
}

/** 与えられた4つのダイスの目から、可能な全てのユニークな合計値のペアを生成します。
 * @param {number[]} dice - 4つのダイスの目の配列。
 * @returns {Array<Array<number>>} 2つの合計値からなるペアの配列。
 */
function generatePossibleSumPairs(dice) { /* ... (実装は変更なし) ... */
    if (!dice || dice.length !== 4) return [];

    const combinations = [
        [[dice[0], dice[1]], [dice[2], dice[3]]],
        [[dice[0], dice[2]], [dice[1], dice[3]]],
        [[dice[0], dice[3]], [dice[1], dice[2]]]
    ];

    const sumPairs = [];
    const seenPairKeys = new Set();

    combinations.forEach(comboGroup => {
        const sum1 = comboGroup[0][0] + comboGroup[0][1];
        const sum2 = comboGroup[1][0] + comboGroup[1][1];
        const value = [sum1, sum2];
        const key = value.slice().sort((a, b) => a - b).join(',');
        if (!seenPairKeys.has(key)) {
            sumPairs.push(value);
            seenPairKeys.add(key);
        }
    });
    return sumPairs;
}

/** 指定されたダイスの合計値ペアで、プレイヤーが1マスでも進行/配置可能かを判定(実際の盤面変更なし)。
 * @param {number[]} sumPair - [sumA, sumB] 形式のダイス合計値ペア。
 * @param {object} roomData - 現在のFirestoreの部屋データ。
 * @param {string} playerId - 判定対象のプレイヤーID。
 * @returns {boolean} 進行/配置可能ならtrue、そうでなければfalse。
 */
function canPlayerAdvanceWithPair(sumPair, roomData, playerId) { /* ... (実装は変更なし) ... */
    const tempWorkMarkers = JSON.parse(JSON.stringify(roomData.turnTemporaryMarkers || {}));
    const claimedCols = roomData.claimedColumns || {};
    const playerProgressMarkers = roomData.players[playerId]?.progressMarkers || {};

    function checkAdvance(trackSum, currentTempMarkersState) {
        const trackSumStr = String(trackSum);
        if (trackSum < 2 || trackSum > 12) return false;
        if (claimedCols[trackSumStr] && claimedCols[trackSumStr] !== playerId) return false;
        if (claimedCols[trackSumStr] && claimedCols[trackSumStr] === playerId) return false;

        const currentTempPosOnTrack = currentTempMarkersState[trackSumStr];
        const playerProgressOnTrack = playerProgressMarkers[trackSumStr] || 0;

        let basePosition = playerProgressOnTrack;
        if (currentTempPosOnTrack) { basePosition = currentTempPosOnTrack; }

        if (basePosition >= TRACK_CONFIG[trackSumStr]) return false;

        const numTempMarkersCurrently = Object.keys(currentTempMarkersState).length;
        if (!currentTempMarkersState[trackSumStr] && numTempMarkersCurrently >= 3) {
            return false;
        }
        return true;
    }

    let canAdvanceFirstSum = checkAdvance(sumPair[0], JSON.parse(JSON.stringify(tempWorkMarkers)));
    let canAdvanceSecondSum = checkAdvance(sumPair[1], JSON.parse(JSON.stringify(tempWorkMarkers)));

    if (canAdvanceFirstSum) {
        let tempAfterFirst = JSON.parse(JSON.stringify(tempWorkMarkers));
        if (tempAfterFirst[String(sumPair[0])]) { tempAfterFirst[String(sumPair[0])]++; }
        else { tempAfterFirst[String(sumPair[0])] = (playerProgressMarkers[String(sumPair[0])] || 0) + 1; }

        if (sumPair[0] === sumPair[1] || checkAdvance(sumPair[1], tempAfterFirst)) return true;
        return true;
    }
    if (canAdvanceSecondSum) {
        return true;
    }

    return false;
}

/** ダイスの目から可能なペア組み合わせを生成しUIに表示。選択でラベルに .selected 付与。
 * @param {number[]} dice - 4つのダイスの目の配列。
 */
function generateDiceCombinations(dice) { /* ... (実装は変更なし) ... */
    if (!dice || dice.length !== 4) {
        console.error("generateDiceCombinations: Invalid dice array provided.", dice);
        if (diceCombinationChoiceArea) {
            diceCombinationChoiceArea.innerHTML = '<p>ダイス情報が不正確です。</p>';
            diceCombinationChoiceArea.classList.remove('hidden');
        }
        return;
    }

    const sumPairsForDisplay = [];
    const combinationsForStrings = [
        [[dice[0], dice[1]], [dice[2], dice[3]]],
        [[dice[0], dice[2]], [dice[1], dice[3]]],
        [[dice[0], dice[3]], [dice[1], dice[2]]]
    ];
    const seenPairKeysForDisplay = new Set();

    combinationsForStrings.forEach(comboGroup => {
        const sum1 = comboGroup[0][0] + comboGroup[0][1];
        const sum2 = comboGroup[1][0] + comboGroup[1][1];
        const value = [sum1, sum2];
        const displayString = `(${comboGroup[0].join('+')}=${sum1} と ${comboGroup[1].join('+')}=${sum2})`;
        const key = value.slice().sort((a,b)=>a-b).join(',');
        if (!seenPairKeysForDisplay.has(key)) {
            sumPairsForDisplay.push({ display: displayString, value: value });
            seenPairKeysForDisplay.add(key);
        }
    });

    if (diceCombinationChoiceArea) {
        diceCombinationChoiceArea.innerHTML = '';
        if (sumPairsForDisplay.length > 0) {
            sumPairsForDisplay.forEach((combo, index) => {
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

/** 選択されたダイス組み合わせに基づき一時マーカーを配置/進行。バスト処理も含む。
 * 結果はFirestoreに保存。
 */
async function selectDiceCombination() { /* ... (実装は変更なし) ... */
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

            const currentTempPosOnTrack = currentTempMarkersState[trackSumStr]; // 現在のターンで既に置かれている一時マーカーの位置
            const playerProgressOnTrack = roomData.players[localPlayerId]?.progressMarkers?.[trackSumStr] || 0; // 過去に確定した中間マーカーの位置

            let basePosition = playerProgressOnTrack; // 基本の開始位置は中間マーカー
            if (currentTempPosOnTrack) { // もし既にこのターンで一時マーカーが置かれていれば、それが開始位置
                basePosition = currentTempPosOnTrack;
            }

            if (basePosition >= TRACK_CONFIG[trackSumStr]) return false; // 既にゴールしているか、ゴールを超えているトラックには進めない

            // 3マーカー制限のチェック: 新規に一時マーカーを置く場合のみ
            const numTempMarkersCurrently = Object.keys(currentTempMarkersState).length;
            if (!currentTempMarkersState[trackSumStr] && numTempMarkersCurrently >= 3) {
                return false; // 既に3つ一時マーカーがあり、このトラックが新規なら置けない
            }

            // 進行可能と判断し、仮のマーカー状態を更新
            if (currentTempMarkersState[trackSumStr]) {
                currentTempMarkersState[trackSumStr]++; // 既存の一時マーカーを1マス進める
            } else {
                // 新規に一時マーカーを置く。開始位置は中間マーカーの次か、なければ1番目のマス
                currentTempMarkersState[trackSumStr] = (playerProgressOnTrack > 0 ? playerProgressOnTrack : 0) + 1;
            }
            return true; // 進行/配置成功
        }

        // 選択されたダイス合計値ペア (chosenSums) で進行を試みる
        if (attemptToAdvanceOnTrack(chosenSums[0], tempWorkMarkers)) {
            progressedThisPair = true;
        }
        // 1つ目の合計値で進行後、続けて2つ目の合計値でも進行を試みる (マーカー状態は tempWorkMarkers で引き継がれる)
        if (attemptToAdvanceOnTrack(chosenSums[1], tempWorkMarkers)) {
            progressedThisPair = true;
        }

        if (!progressedThisPair) { // どちらの合計値でも進行できなかった場合
            isBust = true;
        }

        // Firestoreに保存する更新内容を準備
        const updatesForFirestore = {
            turnChosenSums: chosenSums, // プレイヤーが選択した合計値ペア
            turnTemporaryMarkers: isBust ? {} : tempWorkMarkers, // バストなら一時マーカーはリセット、そうでなければ更新されたマーカー群
            // turnBusted は以下で明示的に設定
        };

        if (isBust) { // バストした場合の追加処理
            setDisplayMessage("バストしました！進行は失われ、次のプレイヤーのターンに移ります。", "error"); // 即時フィードバック
            updatesForFirestore.activePlayerId = getNextPlayerId(roomData); // 次のプレイヤーへターン移行
            updatesForFirestore.turnDiceRoll = []; // ダイスロール結果リセット
            updatesForFirestore.turnChosenSums = []; // 選択合計値リセット
            updatesForFirestore.turnBusted = false; // ★★★ 次のターンのために必ずfalse ★★★
            // turnTemporaryMarkers は isBust ? {} により既に空になっている
        } else {
            updatesForFirestore.turnBusted = false; // バストしなかった場合も、このターンのバスト状態はfalseで確定
        }

        await roomRef.update(updatesForFirestore); // Firestore更新
        // UIの更新は onSnapshot リスナー (listenToRoomUpdates) が検知して行う

    } catch (error) {
        console.error("Error in selectDiceCombination (advancing markers): ", error);
        setDisplayMessage("マーカー進行処理エラー: " + error.message, "error");
    }
}


/** ボード上のマーカー表示を全体的に更新。永続進捗、占領、一時マーカーを描画。重なりオフセット適用。
 * ボード上のマーカー表示を全体的に更新します。
 * プレイヤーの確定マーカー(progressMarkers)、占領マーカー(claimedColumns)、
 * および現在アクティブなプレイヤーの一時マーカー(turnTemporaryMarkers)をFirestoreのデータに基づいて描画します。
 * マーカーが同じセルに複数存在する場合は、CSSクラス(.marker-offset-X)を適用して視認性を高めます。
 * @param {object|null} roomData - Firestoreの部屋データ。nullの場合は全てのマーカーをクリアします。
 */
function updateBoardMarkers(roomData) {
    if (!gameBoardDiv) { console.error("gameBoardDiv not found in updateBoardMarkers"); return; }
    // 既存のマーカーを全て削除してから再描画
    gameBoardDiv.querySelectorAll('.progress-marker, .claim-marker, .temp-marker').forEach(m => m.remove());

    if (!roomData) { return; } // roomDataがなければ何もしない (クリア済み)

    const getPlayerColorClass = (pId) => { // プレイヤーIDに応じたCSSカラークラスを返す
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

    // 1. 各プレイヤーの「確定マーカー」(progressMarkers) を描画
    //    これらはプレイヤーが「ストップ」した際に保存された中間的な進捗を示す。
    if (roomData.players) {
        for (const pId in roomData.players) {
            if (roomData.players.hasOwnProperty(pId)) {
                const player = roomData.players[pId];
                if (player.progressMarkers) {
                    const playerColorClass = getPlayerColorClass(player.id);
                    for (const trackNumStr in player.progressMarkers) {
                        if (player.progressMarkers.hasOwnProperty(trackNumStr)) {
                            // 既にそのトラックが誰かによって占領されている場合は、確定マーカーを表示しない
                            if (roomData.claimedColumns && roomData.claimedColumns[trackNumStr]) continue;

                            const position = player.progressMarkers[trackNumStr];
                            const trackGoal = TRACK_CONFIG[trackNumStr];

                            // ゴールに達していない確定マーカーのみ表示 (ゴール達は占領マーカーになるため)
                            if (position > 0 && position < trackGoal) {
                                const cellSelector = `.track[data-track-number="${trackNumStr}"] .cell[data-cell-position="${position}"] .marker-container`;
                                const markerContainer = gameBoardDiv.querySelector(cellSelector);
                                if (markerContainer) {
                                    const markerDiv = document.createElement('div');
                                    markerDiv.classList.add('progress-marker', playerColorClass);
                                    markerDiv.dataset.playerId = pId;

                                    // 同じセル内の既存マーカー数に応じてオフセットクラスを付与
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

    // 2. 全プレイヤーの「占領マーカー」(claimedColumns) を描画
    //    これらはトラックのゴールラインに到達し、占領が確定したことを示す。
    if (roomData.claimedColumns) {
        for (const trackNumStr in roomData.claimedColumns) {
            if (roomData.claimedColumns.hasOwnProperty(trackNumStr)) {
                const pId = roomData.claimedColumns[trackNumStr]; // このトラックを占領したプレイヤーID
                const claimedPlayerColorClass = getPlayerColorClass(pId);
                const goalPosition = TRACK_CONFIG[trackNumStr]; // トラックのゴール位置

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

    // 3. 現在のターンプレイヤーの「一時マーカー」(turnTemporaryMarkers) を描画
    //    これらは現在のターンでのみ有効な仮の進捗を示す。
    if (roomData.activePlayerId && roomData.turnTemporaryMarkers) {
        const activePlayerColorClass = getPlayerColorClass(roomData.activePlayerId);
        for (const trackNumStr in roomData.turnTemporaryMarkers) {
            if (roomData.turnTemporaryMarkers.hasOwnProperty(trackNumStr)) {
                const position = roomData.turnTemporaryMarkers[trackNumStr];
                // 有効な位置 (1以上、かつトラックのゴール以内) のマーカーのみ描画
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

/** 「ストップ」処理。一時マーカーを確定し永続化、占領判定、勝利判定、ターン移行。*/
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

        const playerObject = roomData.players[localPlayerId]; // ★ 唯一の宣言箇所
        if (!playerObject) {
            console.error("Player object not found for localPlayerId:", localPlayerId, "in roomData players:", roomData.players);
            setDisplayMessage("プレイヤーデータが見つかりません。エラーが発生しました。", "error");
            return;
        }

        let currentPlayerExistingProgress = playerObject.progressMarkers || {};
        let newPlayerProgressMarkers = JSON.parse(JSON.stringify(currentPlayerExistingProgress));

        if (roomData.turnTemporaryMarkers && typeof roomData.turnTemporaryMarkers === 'object') {
            for (const trackStr in roomData.turnTemporaryMarkers) {
                if (roomData.turnTemporaryMarkers.hasOwnProperty(trackStr)) {
                    const currentTempPosition = roomData.turnTemporaryMarkers[trackStr];
                    newPlayerProgressMarkers[trackStr] = currentTempPosition;
                }
            }
        }

        let updatedClaimedColumns = { ...(roomData.claimedColumns || {}) };
        for (const colStr in newPlayerProgressMarkers) {
            const position = newPlayerProgressMarkers[colStr];
            const trackGoal = TRACK_CONFIG[colStr];
            if (position >= trackGoal && !updatedClaimedColumns[colStr]) {
                updatedClaimedColumns[colStr] = localPlayerId;
            }
        }

        let playerOccupiedCount = 0;
        for (const col in updatedClaimedColumns) {
            if (updatedClaimedColumns[col] === localPlayerId) {
                playerOccupiedCount++;
            }
        }

        const updates = {
            claimedColumns: updatedClaimedColumns,
            turnTemporaryMarkers: {},
            turnDiceRoll: [],
            turnChosenSums: [],
            turnBusted: false,
            [`players.${localPlayerId}.progressMarkers`]: newPlayerProgressMarkers,
            activePlayerId: getNextPlayerId(roomData),
        };

        if (playerOccupiedCount >= 3) {
            updates.status = "finished";
            updates.winnerId = localPlayerId;
        }

        await roomRef.update(updates);
        setDisplayMessage("進行を保存し、ターンを終了しました。", "info");

    } catch (error) {
        console.error("Error stopping turn: ", error);
        setDisplayMessage("ストップ処理エラー: " + error.message, "error");
    }
}

/** 次のターンプレイヤーIDを決定。参加順でソートし循環。
 * @param {object} roomData - 現在の部屋データ。
 * @returns {string|null} 次のプレイヤーID。なければnull。
 */
function getNextPlayerId(roomData) { /* ... (実装は変更なし) ... */
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
/** ランダムなプレイヤーIDを生成。 @returns {string} */
function generatePlayerId() { /* ... (実装は変更なし) ... */
    return Math.random().toString(36).substr(2, 9);
}
/** ランダムな部屋IDを生成 (英大文字と数字)。 @returns {string} */
function generateRoomId() { /* ... (実装は変更なし) ... */
    return Math.random().toString(36).substr(2, 6).toUpperCase();
}

/** ゲーム関連UIの表示/非表示制御。
 * @param {boolean} isHost - ホストか否か。
 * @param {string} [roomStatus="waiting"] - 部屋の状態。
 */
function showGameRelatedUI(isHost, roomStatus = "waiting") { /* ... (実装は変更なし, roomIdDisplay更新はここで行う) ... */
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
    // ロビー画面でも部屋IDを表示する
    if (roomIdDisplay && currentRoomId) {
        roomIdDisplay.textContent = currentRoomId;
    } else if (roomIdDisplay) {
        roomIdDisplay.textContent = '-'; // currentRoomIdがない場合
    }

    if (startGameButton) {
        if (isHost && roomStatus === "waiting") {
            startGameButton.classList.remove('hidden');
        } else {
            startGameButton.classList.add('hidden');
        }
    }
}
/** 部屋管理UIを表示し他を非表示。メッセージ等も初期化。*/
function showRoomManagementUI() { /* ... (実装は変更なし, roomIdDisplayクリアはここで行う) ... */
    const gamePlayArea = document.getElementById('game-play-area');

    if (roomManagementDiv) roomManagementDiv.classList.remove('hidden');

    if (gameInfoDiv) gameInfoDiv.classList.add('hidden');
    if (playerListAreaDiv) playerListAreaDiv.classList.add('hidden');
    if (gamePlayArea) gamePlayArea.classList.add('hidden');

    if (startGameButton) startGameButton.classList.add('hidden');
    if (rollDiceButton) rollDiceButton.disabled = true;
    if (stopButton) stopButton.disabled = true;
    if (roomIdDisplay) roomIdDisplay.textContent = ''; // 部屋管理画面では部屋IDをクリア
    if (messageDisplay) {
        setDisplayMessage('部屋を作成するか、IDを入力して参加してください。', 'info');
    }
}

// --- DOMContentLoaded Initializer ---
document.addEventListener('DOMContentLoaded', () => {
    drawGameBoard(); // ゲームボードの初期描画
    showRoomManagementUI(); // 初期UIとして部屋管理画面を表示

    // 名前や部屋ID入力時に既存メッセージをクリアするイベントリスナー
    const inputsToClearMessage = [hostNameInput, clientNameInput, roomIdInput];
    inputsToClearMessage.forEach(input => {
        if (input) {
            input.addEventListener('input', clearMessageDisplay);
        }
    });
});

// --- Message Display Helper Functions ---
/** `messageDisplay`の内容クリアとスタイルリセット。*/
function clearMessageDisplay() { /* ... (実装は変更なし) ... */
    if (messageDisplay) {
        messageDisplay.textContent = '';
        messageDisplay.className = 'info';
    }
}
/** `messageDisplay`にメッセージとタイプ（スタイル）を設定。
 * @param {string} message - 表示メッセージ。
 * @param {'info'|'success'|'error'} [type='info'] - メッセージタイプ。
 */
function setDisplayMessage(message, type = 'info') { /* ... (実装は変更なし) ... */
    if (messageDisplay) {
        messageDisplay.textContent = message;
        messageDisplay.className = type;
    }
}

// --- Firestore Realtime Listener Setup ---
/** Firestoreドキュメントを監視し、変更時にUIを更新。
 * @param {string} roomId - 監視対象の部屋ID。
 */
let roomUnsubscribe = null;
function listenToRoomUpdates(roomId) {
    if (typeof db === 'undefined') {
        console.error("Firestore (db) is not initialized. Cannot listen to room updates.");
        setDisplayMessage("データベース接続エラー。", "error");
        return;
    }
    if (roomUnsubscribe) { // 既存のリスナーがあれば解除
        roomUnsubscribe();
    }

    // previousActivePlayerId = activePlayerId; // UI更新のために前のターンプレイヤーを保持 // old position
    currentRoomId = roomId; // 現在の部屋IDを更新

    // Firestoreドキュメントの変更を監視
    roomUnsubscribe = db.collection('rooms').doc(roomId)
        .onSnapshot((doc) => {
            const newRoomData = doc.exists ? doc.data() : null;
            const newActivePlayerId = newRoomData ? newRoomData.activePlayerId : null;

            // グローバルな activePlayerId がFirestoreの新しい activePlayerId と異なる場合、
            // (つまり、ターンが実際に変わった場合など) previousActivePlayerId を更新する。
            // ただし、初回読み込み時 (global activePlayerId が null) は除く。
            if (activePlayerId !== null && newActivePlayerId !== activePlayerId) {
                previousActivePlayerId = activePlayerId;
            } else if (activePlayerId === null && newActivePlayerId !== null) {
                // ゲーム開始時や途中参加で初めて activePlayerId が設定される場合
                previousActivePlayerId = null;
            }
            // activePlayerId はこの後、roomData から取得したものでグローバル変数が更新される

            if (doc.exists) {
                const roomData = doc.data(); // const roomData = newRoomData; と同じ

                // グローバル変数を更新 (主にUI表示のため)
                players = Object.values(roomData.players || {}).sort((a,b) => a.joinOrder - b.joinOrder);
                activePlayerId = roomData.activePlayerId; // ★★★ グローバル activePlayerId を最新に更新
                claimedTracks = roomData.claimedColumns || {};
                tempMarkersOnBoard = roomData.turnTemporaryMarkers || {};

                // UIコンポーネントを最新の部屋データで更新
                updatePlayersList(roomData);
                updateCurrentPlayerDisplay(roomData);
                updateBoardMarkers(roomData); // マーカー描画 (確定、占領、一時)
                updateDiceResultDisplay(roomData.turnDiceRoll);
                updateMessageDisplay(roomData); // メッセージ表示

                const isMyTurn = roomData.activePlayerId === localPlayerId;
                const isGamePlaying = roomData.status === 'playing';

                if (isGamePlaying) {
                    showGameRelatedUI(roomData.hostId === localPlayerId, roomData.status);
                    if (startGameButton) startGameButton.classList.add('hidden');

                    const diceRolled = roomData.turnDiceRoll && roomData.turnDiceRoll.length > 0;
                    const combinationChosen = roomData.turnChosenSums && roomData.turnChosenSums.length > 0;
                    const isBustedForThisTurn = roomData.turnBusted;
                    const tempMarkersExist = Object.keys(roomData.turnTemporaryMarkers || {}).length > 0;

                    // === 3つ目の一時マーカー配置選択UIの表示判定と処理 ===
                    // 条件: 自分のターン、バストしていない、ダイス組み合わせ選択済み、
                    //       現在一時マーカーがちょうど2つ、かつ3つ目マーカー選択UIがまだ表示されていない
                    if (isMyTurn && !isBustedForThisTurn && combinationChosen &&
                        Object.keys(tempMarkersOnBoard).length === 2 &&
                        placeThirdMarkerChoiceArea.classList.contains('hidden')) {

                        const chosenSumValues = roomData.turnChosenSums; // 例: [6, 7]
                        const track1Str = String(chosenSumValues[0]);
                        const track2Str = String(chosenSumValues[1]);
                        const currentActivePlayerId = roomData.activePlayerId; // onSnapshot時の最新を使う

                        const isTrack1NewForTemp = !tempMarkersOnBoard[track1Str];
                        const isTrack2NewForTemp = !tempMarkersOnBoard[track2Str];

                        if (track1Str !== track2Str && isTrack1NewForTemp && isTrack2NewForTemp &&
                            checkIfCanAdvanceSingleSum(chosenSumValues[0], roomData, tempMarkersOnBoard, currentActivePlayerId, true) && // isForNewPlacement = true
                            checkIfCanAdvanceSingleSum(chosenSumValues[1], roomData, tempMarkersOnBoard, currentActivePlayerId, true) ) { // isForNewPlacement = true

                            // 全ての条件を満たせば、3つ目マーカー選択UIを表示
                            displayThirdMarkerChoiceUI(chosenSumValues, roomData);
                            // 他の操作UIを無効化/非表示
                            if(diceCombinationChoiceArea) diceCombinationChoiceArea.classList.add('hidden');
                            if(rollDiceButton) rollDiceButton.disabled = true;
                            if(stopButton) stopButton.disabled = true;
                            return; // ユーザーの選択を待つため、このonSnapshotの処理をここで終了
                        }
                    }

                    // 3つ目マーカー選択UIが表示されている場合は、他のボタン制御は行わない (ユーザーの選択待ち)
                    if (!placeThirdMarkerChoiceArea.classList.contains('hidden')) {
                        return;
                    }

                    // 通常のボタン状態制御 (ロール/続ける、ストップ)
                    if (rollDiceButton) {
                        const canMakeFirstRoll = isMyTurn && isGamePlaying && !isBustedForThisTurn && !diceRolled;
                        const canContinue = isMyTurn && isGamePlaying && !isBustedForThisTurn && diceRolled && combinationChosen && tempMarkersExist;

                        if (canMakeFirstRoll) {
                            rollDiceButton.disabled = false;
                            rollDiceButton.textContent = 'ダイスを振る';
                        } else if (canContinue) {
                            rollDiceButton.disabled = false;
                            rollDiceButton.textContent = '続ける';
                        } else {
                            rollDiceButton.disabled = true;
                            if (!isMyTurn || !isGamePlaying) {
                                rollDiceButton.textContent = 'ダイスを振る';
                            } else if (isMyTurn && isGamePlaying && isBustedForThisTurn) {
                                rollDiceButton.textContent = 'バストしました';
                            } else if (isMyTurn && isGamePlaying && diceRolled && !combinationChosen) {
                                 rollDiceButton.textContent = '組み合わせ選択中';
                            } else {
                                 rollDiceButton.textContent = 'ダイスを振る';
                            }
                        }
                    }

                    if (stopButton) {
                        const canStop = isMyTurn && isGamePlaying && !isBustedForThisTurn && diceRolled && combinationChosen && tempMarkersExist;
                        stopButton.disabled = !canStop;
                    }

                    if (diceCombinationChoiceArea) {
                        const showCombinations = isMyTurn && isGamePlaying && diceRolled && !isBustedForThisTurn && !combinationChosen;
                        if (showCombinations) {
                            diceCombinationChoiceArea.innerHTML = '';
                            generateDiceCombinations(roomData.turnDiceRoll);
                            diceCombinationChoiceArea.classList.remove('hidden');
                        } else {
                            diceCombinationChoiceArea.classList.add('hidden');
                            if (isMyTurn && isGamePlaying && diceRolled && !isBustedForThisTurn && combinationChosen) {
                                if(diceCombinationChoiceArea.innerHTML === '' || !diceCombinationChoiceArea.querySelector('input')){
                                    generateDiceCombinations(roomData.turnDiceRoll); // 再描画が必要な場合
                                }
                                diceCombinationChoiceArea.querySelectorAll('input, button').forEach(el => el.disabled = true);
                                diceCombinationChoiceArea.classList.remove('hidden');
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
                     if (placeThirdMarkerChoiceArea) placeThirdMarkerChoiceArea.classList.add('hidden');


                } else if (roomData.status === 'finished') {
                    showGameRelatedUI(roomData.hostId === localPlayerId, roomData.status);
                    if (rollDiceButton) rollDiceButton.disabled = true;
                    if (stopButton) stopButton.disabled = true;
                    if (diceCombinationChoiceArea) diceCombinationChoiceArea.classList.add('hidden');
                    if (placeThirdMarkerChoiceArea) placeThirdMarkerChoiceArea.classList.add('hidden');
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

/** ゲームの現在の状況に基づいてメッセージエリア (`messageDisplay`) を更新します。
 * @param {object|null} roomData - Firestoreの部屋データ。nullならデフォルト表示。
 */
function updateMessageDisplay(roomData) { /* ... (実装は変更なし) ... */
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

    // roomData.turnBusted に依存したバストメッセージ表示は削除。
    // バストは selectDiceCombination または rollDice (自動バスト) で即時表示される。
    // 他プレイヤーのバストは、ターンが移った際の通常のメッセージでカバーされる。
    // if (roomData.turnBusted && roomData.activePlayerId !== previousActivePlayerId) {
    //     const bustedPlayer = roomData.players[previousActivePlayerId];
    //      if (bustedPlayer) {
    //         setDisplayMessage(`${bustedPlayer.name}さんがバストしました。`, "error");
    //      } else {
    //         setDisplayMessage("バストが発生しました。", "error");
    //      }
    // }


    if (roomData.status === 'playing') {
        if (isMyTurn) {
            if (roomData.turnDiceRoll && roomData.turnDiceRoll.length > 0) {
                if (roomData.turnChosenSums && roomData.turnChosenSums.length > 0) {
                     // 3つ目マーカー選択UIが表示されているかチェック
                    if (!placeThirdMarkerChoiceArea.classList.contains('hidden')) {
                        setDisplayMessage("3つ目の一時マーカーを配置するトラックを選んでください。", "info");
                    } else {
                        setDisplayMessage("マーカーを進めました。「続ける」か「ストップ」を選択してください。", "info");
                    }
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
    } else if (!roomData.turnBusted) { // finishedでもなく、バストメッセージでもない場合
        setDisplayMessage('ゲームの準備ができました。', 'info');
    }
}

// --- Helper Functions for 3rd Marker Choice ---

/**
 * 指定された単一のトラック合計値に対して、プレイヤーが一時マーカーを「新規に」配置可能か、
 * または「既存の一時マーカーを1マス進める」ことが可能かを判定します。
 * 3マーカー制限、占領、ゴール済みなどを考慮します。
 * @param {number} trackSum - 対象のトラック番号 (ダイスの合計値)。
 * @param {object} roomData - 現在のFirestoreの部屋データ。
 * @param {object} currentTurnMarkers - 現在のターンで既に配置されている一時マーカーの状態 ({ trackNumStr: position })。
 * @param {string} playerId - 操作プレイヤーのID。
 * @param {boolean} [isForNewPlacement=false] - このトラックに「新規」でマーカーを置く場合の判定か。
 * @returns {boolean} 進行/配置可能ならtrue。
 */
function checkIfCanAdvanceSingleSum(trackSum, roomData, currentTurnMarkers, playerId, isForNewPlacement = false) {
    const trackSumStr = String(trackSum);
    if (trackSum < 2 || trackSum > 12) return false;

    const claimedCols = roomData.claimedColumns || {};
    if (claimedCols[trackSumStr] && claimedCols[trackSumStr] !== playerId) return false;
    if (claimedCols[trackSumStr] && claimedCols[trackSumStr] === playerId) return false;

    const currentTempPosOnTrack = currentTurnMarkers[trackSumStr];
    const playerProgressOnTrack = roomData.players[playerId]?.progressMarkers?.[trackSumStr] || 0;

    let basePosition = playerProgressOnTrack;
    if (currentTempPosOnTrack) {
        basePosition = currentTempPosOnTrack;
    }

    if (basePosition >= TRACK_CONFIG[trackSumStr]) return false;

    if (isForNewPlacement) {
        const numTempMarkersCurrently = Object.keys(currentTurnMarkers).length;
        if (!currentTurnMarkers[trackSumStr] && numTempMarkersCurrently >= 3) {
            return false;
        }
    }
    return true;
}


/**
 * 3つ目の一時マーカーを配置するトラックをプレイヤーに選択させるためのUIを動的に生成し表示します。
 * @param {number[]} sums - プレイヤーが選択可能な2つのトラック番号 (ダイスの合計値) の配列。例: `[6, 7]`。
 * @param {object} roomData - 現在の部屋データ (handleThirdMarkerChoice に渡すため)。
 */
function displayThirdMarkerChoiceUI(sums, roomData) {
    if (!placeThirdMarkerChoiceArea) return;

    placeThirdMarkerChoiceArea.innerHTML = '<h4 id="third-marker-choice-title">3つ目のマーカーを配置するトラックを選択してください:</h4>';

    sums.forEach(sumValue => {
        const button = document.createElement('button');
        button.textContent = `トラック ${sumValue} に配置`;
        button.classList.add('third-marker-choice-btn');
        button.dataset.chosenTrack = sumValue;
        button.onclick = () => handleThirdMarkerChoice(sumValue, roomData);
        placeThirdMarkerChoiceArea.appendChild(button);
    });
    placeThirdMarkerChoiceArea.classList.remove('hidden');
}

/**
 * プレイヤーが選択した3つ目の一時マーカートラックに基づき、盤面状態 (turnTemporaryMarkers) を更新しFirestoreに保存。
 * @param {number} chosenTrackNum - プレイヤーが選択した3つ目のマーカーを配置するトラック番号。
 * @param {object} roomDataForChoice - 選択UIが表示された「直前」の部屋データ (2つの一時マーカー情報を含む)。
 */
async function handleThirdMarkerChoice(chosenTrackNum, roomDataForChoice) { // originalSums は実際には使わないので削除
    if (!currentRoomId || !localPlayerId) {
        setDisplayMessage("エラー: 部屋またはプレイヤー情報がありません。", "error"); return;
    }
    clearMessageDisplay();

    let newTempMarkers = JSON.parse(JSON.stringify(roomDataForChoice.turnTemporaryMarkers || {}));
    const chosenTrackStr = String(chosenTrackNum);
    const playerProgressOnChosenTrack = roomDataForChoice.players[localPlayerId]?.progressMarkers?.[chosenTrackStr] || 0;

    newTempMarkers[chosenTrackStr] = (playerProgressOnChosenTrack > 0 ? playerProgressOnChosenTrack : 0) + 1;

    const updates = {
        turnTemporaryMarkers: newTempMarkers,
    };

    const roomRef = db.collection('rooms').doc(currentRoomId);
    try {
        await roomRef.update(updates);
        if(placeThirdMarkerChoiceArea) placeThirdMarkerChoiceArea.classList.add('hidden');
        setDisplayMessage(`トラック${chosenTrackNum}にマーカーを配置しました。「続ける」か「ストップ」を選択してください。`, 'info');
    } catch (error) {
        console.error("Error updating temp markers after 3rd marker choice:", error);
        setDisplayMessage("3つ目のマーカー配置処理でエラーが発生しました。", "error");
    }
}
