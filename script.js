// Firebaseの初期化 (有効化)
if (typeof firebase !== 'undefined' && typeof firebaseConfig !== 'undefined') {
    try {
        const app = firebase.initializeApp(firebaseConfig);
        var db = firebase.firestore();
        console.log("Firebase initialized successfully");
    } catch (e) {
        console.error("Firebase initialization failed: ", e);
        alert("Firebaseの初期化に失敗しました。設定を確認してください。");
    }
} else {
    console.error("Firebase SDK not loaded or firebaseConfig is not defined. Make sure firebase-config.js is correct and Firebase SDKs are included in index.html, and that firebase-config.js is loaded BEFORE this script.");
    alert("Firebase SDKまたは設定が読み込まれていません。");
}

// --- DOM要素の取得 ---
const playerNameInput = document.getElementById('player-name');
const createRoomButton = document.getElementById('create-room');
const roomIdInput = document.getElementById('room-id');
const joinRoomButton = document.getElementById('join-room');
const startGameButton = document.getElementById('start-game');
const roomManagementDiv = document.getElementById('room-management');
const gameAreaDiv = document.getElementById('game-area');
const currentPlayerSpan = document.querySelector('#current-player span');
const playersListDiv = document.getElementById('players-list');
const gameBoardDiv = document.getElementById('game-board');
const diceResultsDiv = document.getElementById('dice-results');
const rollDiceButton = document.getElementById('roll-dice');
const diceCombinationAreaDiv = document.getElementById('dice-combination-area');
const diceCombinationsDiv = document.getElementById('dice-combinations');
const stopTurnButton = document.getElementById('stop-turn');
const continueTurnButton = document.getElementById('continue-turn');

// --- ゲーム設定 ---
const TRACK_CONFIG = {
    2: 3, 3: 5, 4: 7, 5: 9, 6: 11, 7: 13,
    8: 11, 9: 9, 10: 7, 11: 5, 12: 3
};
const PLAYER_COLORS = ['red', 'blue', 'green', 'yellow']; // 仮のプレイヤーカラー

// --- ゲーム状態 (Firestoreと同期) ---
let currentRoomId = null;
let currentPlayerName = '';
let localPlayerId = null; // 自分のID
let players = []; // Firestoreから同期
let activePlayerId = null; // Firestoreから同期
let tempMarkersOnBoard = []; // Firestoreから同期 (基本的には自分のターンの一時マーカー)
let claimedTracks = {}; // Firestoreから同期

// --- UI制御のための追加グローバル変数 ---
let previousActivePlayerId = null;
let myTurnJustEndedAndBusted = false;

// --- 関数定義 ---

/**
 * ゲームボードを描画する関数
 */
function drawGameBoard() {
    gameBoardDiv.innerHTML = '';
    for (let i = 2; i <= 12; i++) {
        const trackDiv = document.createElement('div');
        trackDiv.classList.add('track');
        trackDiv.dataset.trackNumber = i;

        const trackLabel = document.createElement('div');
        trackLabel.classList.add('track-label');
        trackLabel.textContent = i;
        trackDiv.appendChild(trackLabel);

        const cantStopSpace = document.createElement('div');
        cantStopSpace.classList.add('cant-stop-space');
        cantStopSpace.textContent = 'CS';
        trackDiv.appendChild(cantStopSpace);

        const numCells = TRACK_CONFIG[i];
        for (let j = 1; j <= numCells; j++) {
            const cellDiv = document.createElement('div');
            cellDiv.classList.add('cell');
            cellDiv.dataset.track = i;
            cellDiv.dataset.cell = j;
            if (j === numCells) {
                cellDiv.classList.add('goal-line');
            }
            const markerContainer = document.createElement('div');
            markerContainer.classList.add('marker-container');
            cellDiv.appendChild(markerContainer);
            trackDiv.appendChild(cellDiv);
        }
        gameBoardDiv.appendChild(trackDiv);
    }
    console.log("Game board drawn.");
}

/**
 * 部屋を作成する処理
 */
async function createRoom() {
    currentPlayerName = playerNameInput.value.trim();
    if (!currentPlayerName) {
        alert("プレイヤー名を入力してください。");
        return;
    }
    if (typeof db === 'undefined') {
        alert("データベースに接続できません。設定を確認してください。");
        return;
    }
    localPlayerId = db.collection('rooms').doc().id.substring(0, 8);
    const newRoomId = db.collection('rooms').doc().id.substring(0, 6);
    currentRoomId = newRoomId;

    const playerObject = {
        id: localPlayerId, name: currentPlayerName, color: PLAYER_COLORS[0],
        joinOrder: 1, isHost: true, occupiedTracksCount: 0
    };
    const roomData = {
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        hostPlayerId: localPlayerId, status: "waiting", activePlayerId: null,
        turnDiceRoll: [], turnChosenSums: [], turnTemporaryMarkers: [],
        claimedTracks: {}, winnerId: null,
        players: { [localPlayerId]: playerObject }
    };
    try {
        await db.collection('rooms').doc(currentRoomId).set(roomData);
        console.log(`Room created in Firestore with ID: ${currentRoomId} by ${localPlayerId}`);
        players = [playerObject];
        alert(`部屋が作成されました。部屋ID: ${currentRoomId}`);
        roomManagementDiv.style.display = 'none';
        gameAreaDiv.style.display = 'block';
        startGameButton.disabled = false;
        listenToRoomUpdates(currentRoomId);
    } catch (error) {
        console.error("Error creating room: ", error);
        alert("部屋の作成に失敗しました。");
        currentRoomId = null; localPlayerId = null;
    }
}

/**
 * 部屋に参加する処理
 */
async function joinRoom() {
    currentPlayerName = playerNameInput.value.trim();
    const roomIdToJoin = roomIdInput.value.trim();
    if (!currentPlayerName) { alert("プレイヤー名を入力してください。"); return; }
    if (!roomIdToJoin) { alert("部屋IDを入力してください。"); return; }
    if (typeof db === 'undefined') { alert("データベースに接続できません。設定を確認してください。"); return; }

    try {
        const roomRef = db.collection('rooms').doc(roomIdToJoin);
        const roomDoc = await roomRef.get();
        if (!roomDoc.exists) { alert("指定された部屋IDの部屋が見つかりません。"); return; }

        const roomData = roomDoc.data();
        const numPlayers = Object.keys(roomData.players).length;
        if (numPlayers >= 4) { alert("この部屋は満員です。"); return; }
        if (roomData.status !== "waiting") { alert("このゲームは既に開始されているか終了しています。"); return; }

        localPlayerId = db.collection('rooms').doc().id.substring(0, 8);
        const playerObject = {
            id: localPlayerId, name: currentPlayerName, color: PLAYER_COLORS[numPlayers],
            joinOrder: numPlayers + 1, isHost: false, occupiedTracksCount: 0
        };
        await roomRef.update({ [`players.${localPlayerId}`]: playerObject });
        currentRoomId = roomIdToJoin;
        console.log(`${currentPlayerName} joined room: ${currentRoomId}`);
        alert(`部屋 ${currentRoomId} に参加しました。`);
        roomManagementDiv.style.display = 'none';
        gameAreaDiv.style.display = 'block';
        startGameButton.style.display = 'none';
        listenToRoomUpdates(currentRoomId);
    } catch (error) {
        console.error("Error joining room: ", error);
        alert("部屋への参加に失敗しました。");
        localPlayerId = null; currentRoomId = null;
    }
}

/**
 * ゲームを開始する処理
 */
async function startGame() {
    if (typeof db === 'undefined' || !currentRoomId) {
        alert("データベースに接続されていないか、部屋が存在しません。"); return;
    }
    const roomRef = db.collection('rooms').doc(currentRoomId);
    try {
        const roomDoc = await roomRef.get();
        if (!roomDoc.exists) { alert("部屋のデータが見つかりません。"); return; }
        const roomData = roomDoc.data();
        const playerIds = Object.keys(roomData.players);
        if (playerIds.length < 2 || playerIds.length > 4) {
            alert("ゲームを開始するには2～4人のプレイヤーが必要です。"); return;
        }
        let firstPlayerId = null; let minJoinOrder = Infinity;
        for (const playerId in roomData.players) {
            if (roomData.players[playerId].joinOrder < minJoinOrder) {
                minJoinOrder = roomData.players[playerId].joinOrder;
                firstPlayerId = playerId;
            }
        }
        if (!firstPlayerId) { alert("最初のプレイヤーを決定できませんでした。"); return; }
        await roomRef.update({
            status: "playing", activePlayerId: firstPlayerId,
            turnDiceRoll: [], turnTemporaryMarkers: [], claimedTracks: {}, winnerId: null
        });
        console.log("Game started in Firestore! First turn:", firstPlayerId);
    } catch (error) {
        console.error("Error starting game: ", error);
        alert("ゲームの開始に失敗しました。");
    }
}

/**
 * プレイヤーリスト表示を更新
 */
function updatePlayersList() {
    playersListDiv.innerHTML = '<h4>参加者:</h4>';
    players.forEach(p => {
        const pDiv = document.createElement('div');
        pDiv.textContent = `${p.name} (${p.color})`;
        pDiv.style.color = p.color;
        playersListDiv.appendChild(pDiv);
    });
}

/**
 * 現在のターンプレイヤー表示を更新
 */
function updateCurrentPlayerDisplay() {
    if (activePlayerId) {
        const activeP = players.find(p => p.id === activePlayerId);
        currentPlayerSpan.textContent = activeP ? activeP.name : '未定';
    } else {
        currentPlayerSpan.textContent = 'ゲーム開始前';
    }
}

/**
 * ダイスを振る処理
 */
async function rollDice() {
    if (typeof db === 'undefined' || !currentRoomId || !localPlayerId) {
        alert("データベースに接続されていないか、ゲームに参加していません。"); return;
    }
    const roomRef = db.collection('rooms').doc(currentRoomId);
    try {
        const roomDoc = await roomRef.get();
        if (!roomDoc.exists) { alert("部屋のデータが見つかりません。"); return; }
        const roomData = roomDoc.data();
        if (roomData.activePlayerId !== localPlayerId) { alert("あなたのターンではありません。"); return; }
        if (roomData.turnDiceRoll && roomData.turnDiceRoll.length > 0) {
            alert("既にダイスは振られています。組み合わせを選択するか、ストップ/コンティニューしてください。"); return;
        }
        const results = [];
        for (let i = 0; i < 4; i++) { results.push(Math.floor(Math.random() * 6) + 1); }
        await roomRef.update({ turnDiceRoll: results });
        console.log("Dice rolled and results stored in Firestore:", results);
    } catch (error) {
        console.error("Error rolling dice: ", error);
        alert("ダイスロールに失敗しました。");
    }
}

/**
 * ダイスの組み合わせを生成して表示する
 */
function generateDiceCombinations(dice) {
    const combinations = [];
    combinations.push([[dice[0], dice[1]], [dice[2], dice[3]]]);
    combinations.push([[dice[0], dice[2]], [dice[1], dice[3]]]);
    combinations.push([[dice[0], dice[3]], [dice[1], dice[2]]]);

    diceCombinationsDiv.innerHTML = '';
    diceCombinationAreaDiv.style.display = 'block';
    const uniqueCombinations = []; const seenSums = new Set();
    combinations.forEach(combo => {
        const sum1 = combo[0][0] + combo[0][1];
        const sum2 = combo[1][0] + combo[1][1];
        const key = [sum1, sum2].sort().join(',');
        if (!seenSums.has(key)) {
            uniqueCombinations.push({ pair1: sum1, pair2: sum2, originalDice: combo });
            seenSums.add(key);
        }
    });
    if (uniqueCombinations.length === 0 && combinations.length > 0) {
        const sum1 = combinations[0][0][0] + combinations[0][0][1];
        const sum2 = combinations[0][1][0] + combinations[0][1][1];
        uniqueCombinations.push({ pair1: sum1, pair2: sum2, originalDice: combinations[0]});
    }
    uniqueCombinations.forEach((combo, index) => {
        const label = document.createElement('label');
        const radio = document.createElement('input');
        radio.type = 'radio'; radio.name = 'diceCombination'; radio.value = index;
        radio.dataset.sum1 = combo.pair1; radio.dataset.sum2 = combo.pair2;
        label.appendChild(radio);
        label.append(` (${combo.originalDice[0].join('+')}=${combo.pair1} と ${combo.originalDice[1].join('+')}=${combo.pair2})`);
        diceCombinationsDiv.appendChild(label);
    });
    if (uniqueCombinations.length > 0) {
        const selectButton = document.createElement('button');
        selectButton.textContent = 'この組み合わせで進む';
        selectButton.onclick = selectDiceCombination;
        diceCombinationsDiv.appendChild(selectButton);
    } else {
        diceCombinationsDiv.textContent = '有効な組み合わせがありません。';
        console.log("No valid combinations, potentially bust.");
        // 自動バスト処理をここで行うか、プレイヤーに通知して手動でターンを終了させるか検討
        // ここでは handleBust を直接呼ばず、UIで通知し、プレイヤーが手動で「ストップ」を押してバスト処理に進む流れも考えられる。
        // 今回の仕様では、進行不可なら自動的にバストとして処理を進める。
        if(localPlayerId === activePlayerId) { // 自分のターンで組み合わせがない場合のみ
            handleBust();
        }
    }
    console.log("Dice combinations generated:", uniqueCombinations);
}

/**
 * 選択されたダイスの組み合わせでマーカーを進める処理
 */
async function selectDiceCombination() {
    if (typeof db === 'undefined' || !currentRoomId || !localPlayerId) return;
    const selectedRadio = document.querySelector('input[name="diceCombination"]:checked');
    if (!selectedRadio) { alert("ダイスの組み合わせを選択してください。"); return; }

    const sum1 = parseInt(selectedRadio.dataset.sum1);
    const sum2 = parseInt(selectedRadio.dataset.sum2);
    const roomRef = db.collection('rooms').doc(currentRoomId);
    try {
        await db.runTransaction(async (transaction) => {
            const roomDoc = await transaction.get(roomRef);
            if (!roomDoc.exists) { throw "Room not found!"; }
            const roomData = roomDoc.data();
            if (roomData.activePlayerId !== localPlayerId) { throw "Not your turn!"; }
            if (!roomData.turnDiceRoll || roomData.turnDiceRoll.length === 0) { throw "Dice not rolled yet for this turn!"; }

            let currentTempMarkers = JSON.parse(JSON.stringify(roomData.turnTemporaryMarkers || []));
            const claimedTracksByAny = roomData.claimedTracks || {};

            let canAdvanceSum1 = canAdvanceOnTrack(sum1, currentTempMarkers, claimedTracksByAny, localPlayerId);
            let canAdvanceSum2 = canAdvanceOnTrack(sum2, currentTempMarkers, claimedTracksByAny, localPlayerId);

            const uniqueTracksInTemp = new Set(currentTempMarkers.map(m => m.track));
            let newTracksAttempted = 0;
            if (!uniqueTracksInTemp.has(sum1)) newTracksAttempted++;
            if (sum1 !== sum2 && !uniqueTracksInTemp.has(sum2)) newTracksAttempted++;

            if (uniqueTracksInTemp.size + newTracksAttempted > 3 && !(uniqueTracksInTemp.has(sum1) && uniqueTracksInTemp.has(sum2) && sum1 !== sum2) ) {
                 // 既存のマーカーと新しいマーカーの合計が3を超える場合、かつ両方の目が既存のマーカーでない場合
                 let sum1OnExisting = uniqueTracksInTemp.has(sum1);
                 let sum2OnExisting = uniqueTracksInTemp.has(sum2);

                 if (uniqueTracksInTemp.size === 3 && (!sum1OnExisting || (sum1 !== sum2 && !sum2OnExisting))) {
                    console.log("Bust: Already 3 markers, and selected sums would require a new track or cannot both move existing.");
                    await handleBust(); return;
                 }
                 if (uniqueTracksInTemp.size === 2 && newTracksAttempted === 2){ // 2つマーカーがあり、2つとも新しいトラック
                     console.log("Bust: Already 2 markers, and selected sums are for two new tracks.");
                     await handleBust(); return;
                 }
            }


            let madeProgressThisSelection = false;
            if (canAdvanceSum1) {
                currentTempMarkers = attemptAdvance(sum1, currentTempMarkers, localPlayerId);
                madeProgressThisSelection = true;
            }
             if (sum1 !== sum2) {
                 canAdvanceSum2 = canAdvanceOnTrack(sum2, currentTempMarkers, claimedTracksByAny, localPlayerId); // 再評価
                if (canAdvanceSum2) {
                    currentTempMarkers = attemptAdvance(sum2, currentTempMarkers, localPlayerId);
                    madeProgressThisSelection = true;
                }
            }
            if (!madeProgressThisSelection) {
                console.log("Bust: Could not advance on either sum.");
                transaction.update(roomRef, { turnBusted: true });
                await handleBust();
                return;
            }
            transaction.update(roomRef, {
                turnTemporaryMarkers: currentTempMarkers,
                turnChosenSums: [sum1, sum2],
                turnBusted: false
            });
            console.log("Temporary markers updated in Firestore:", currentTempMarkers);
        });
    } catch (error) {
        console.error("Error selecting dice combination or transaction failed: ", error);
        if (String(error).includes("Room not found")) { alert("部屋が見つかりません。"); }
        else if (String(error).includes("Not your turn")) { alert("あなたのターンではありません。"); }
        else if (String(error).includes("Dice not rolled")) { alert("まだダイスが振られていません。"); }
    }
}

function attemptAdvance(trackNumber, tempMarkers, playerId) {
    let marker = tempMarkers.find(m => m.track === trackNumber);
    if (!marker) {
        marker = { track: trackNumber, position: 1, playerId: playerId };
        tempMarkers.push(marker);
    } else {
        if (marker.position < TRACK_CONFIG[trackNumber]) {
            marker.position++;
        }
    }
    return tempMarkers;
}

function canAdvanceOnTrack(trackNumber, currentTempMarkers, claimedTracksByAny, playerId) {
    if (trackNumber < 2 || trackNumber > 12) return false;
    if (claimedTracksByAny[trackNumber] && claimedTracksByAny[trackNumber] !== playerId) return false;
    if (claimedTracksByAny[trackNumber] && claimedTracksByAny[trackNumber] === playerId) return false;
    const markerOnThisTrack = currentTempMarkers.find(m => m.track === trackNumber);
    if (markerOnThisTrack && markerOnThisTrack.position >= TRACK_CONFIG[trackNumber]) return false;

    const uniqueTracksInTemp = new Set(currentTempMarkers.map(m => m.track));
    if (!markerOnThisTrack && uniqueTracksInTemp.size >= 3) return false;
    return true;
}

/**
 * ボード上のマーカー表示を全体的に更新する
 */
function updateBoardMarkers() {
    document.querySelectorAll('.marker').forEach(m => m.remove());
    const localPlayerObj = players.find(p => p.id === localPlayerId);

    // 現在のターンプレイヤーの一時マーカーを描画
    if (activePlayerId === localPlayerId && tempMarkersOnBoard) {
        tempMarkersOnBoard.forEach(marker => {
            if (!localPlayerObj) return;
            let cellToPlaceOn = marker.position === 0 ?
                gameBoardDiv.querySelector(`.track[data-track-number="${marker.track}"] .cant-stop-space`) :
                gameBoardDiv.querySelector(`.track[data-track-number="${marker.track}"] .cell[data-cell="${marker.position}"]`);
            if (cellToPlaceOn) {
                const markerDiv = document.createElement('div');
                markerDiv.classList.add('marker', 'temp-marker', `player-${players.indexOf(localPlayerObj) + 1}`);
                (cellToPlaceOn.querySelector('.marker-container') || cellToPlaceOn).appendChild(markerDiv);
            }
        });
    }

    // 全プレイヤーの占領マーカーを描画
    players.forEach((player, playerIndex) => {
        const tracksOwnedByPlayer = [];
        for(const trackNo in claimedTracks){
            if(claimedTracks[trackNo] === player.id){
                tracksOwnedByPlayer.push(parseInt(trackNo));
            }
        }
        tracksOwnedByPlayer.forEach(trackNum => {
            const trackDiv = gameBoardDiv.querySelector(`.track[data-track-number="${trackNum}"]`);
            if (trackDiv) {
                const goalCell = trackDiv.querySelector(`.cell[data-cell="${TRACK_CONFIG[trackNum]}"]`);
                if (goalCell) {
                    const claimMarkerDiv = document.createElement('div');
                    claimMarkerDiv.classList.add('marker', `player-${playerIndex + 1}`);
                    claimMarkerDiv.textContent = 'C';
                    claimMarkerDiv.style.fontSize = '10px';
                    claimMarkerDiv.style.textAlign = 'center';
                    claimMarkerDiv.style.lineHeight = '15px';
                    (goalCell.querySelector('.marker-container') || goalCell).appendChild(claimMarkerDiv);
                }
            }
        });
    });
    console.log("Board markers updated.");
}

/**
 * ストップ処理
 */
async function stopTurn() {
    if (typeof db === 'undefined' || !currentRoomId || !localPlayerId) return;
    myTurnJustEndedAndBusted = false;
    const roomRef = db.collection('rooms').doc(currentRoomId);
    try {
        await db.runTransaction(async (transaction) => {
            const roomDoc = await transaction.get(roomRef);
            if (!roomDoc.exists) throw "Room not found!";
            let roomData = roomDoc.data();
            if (roomData.activePlayerId !== localPlayerId) throw "Not your turn!";

            let currentTempMarkers = roomData.turnTemporaryMarkers || [];
            let currentClaimedTracks = roomData.claimedTracks || {};
            let playerState = roomData.players[localPlayerId];
            let playerOccupiedCount = 0;

            Object.values(currentClaimedTracks).forEach(pId => { if (pId === localPlayerId) playerOccupiedCount++; });
            currentTempMarkers.forEach(tempMarker => {
                if (tempMarker.position >= TRACK_CONFIG[tempMarker.track]) {
                    if (!currentClaimedTracks[tempMarker.track]) {
                        currentClaimedTracks[tempMarker.track] = localPlayerId;
                        playerOccupiedCount++;
                    }
                }
            });
            if (playerState) { playerState.occupiedTracksCount = playerOccupiedCount; }

            let nextPlayerId = getNextPlayerId(roomData.players, localPlayerId);
            let gameStatus = roomData.status; let winner = null;
            if (playerOccupiedCount >= 3) {
                gameStatus = "finished"; winner = localPlayerId;
                console.log(`Player ${localPlayerId} wins!`);
            }
            const updates = {
                status: gameStatus, winnerId: winner, activePlayerId: nextPlayerId,
                turnDiceRoll: [], turnTemporaryMarkers: [], turnChosenSums: [], turnBusted: false,
                claimedTracks: currentClaimedTracks,
                [`players.${localPlayerId}.occupiedTracksCount`]: playerOccupiedCount
            };
            transaction.update(roomRef, updates);
            console.log("Turn stopped. Firestore updated. Next player:", nextPlayerId);
        });
    } catch (error) {
        console.error("Error stopping turn: ", error); alert("ストップ処理に失敗しました: " + error);
    }
}

function getNextPlayerId(playersMap, currentPlayerId) {
    const playerArray = Object.values(playersMap).sort((a, b) => a.joinOrder - b.joinOrder);
    const currentIndex = playerArray.findIndex(p => p.id === currentPlayerId);
    const nextPlayer = playerArray[(currentIndex + 1) % playerArray.length];
    return nextPlayer.id;
}

/**
 * 続ける処理
 */
async function continueTurn() {
    if (typeof db === 'undefined' || !currentRoomId || !localPlayerId) return;
    myTurnJustEndedAndBusted = false;
    const roomRef = db.collection('rooms').doc(currentRoomId);
    try {
        const roomDoc = await roomRef.get();
        if (!roomDoc.exists) throw "Room not found!";
        const roomData = roomDoc.data();
        if (roomData.activePlayerId !== localPlayerId) throw "Not your turn!";
        await roomRef.update({
            turnDiceRoll: [], turnChosenSums: [], turnBusted: false
        });
        console.log("Continuing turn. Dice roll reset in Firestore.");
    } catch (error) {
        console.error("Error continuing turn: ", error); alert("継続処理に失敗しました: " + error);
    }
}

/**
 * バスト処理
 */
async function handleBust() {
    if (typeof db === 'undefined' || !currentRoomId || !localPlayerId) {
        console.warn("handleBust called without DB connection or room context, UI alert only.");
        alert("バスト！このターンの進行は失われました。");
        diceResultsDiv.innerHTML = ''; diceCombinationAreaDiv.style.display = 'none';
        rollDiceButton.disabled = true; stopTurnButton.disabled = true; continueTurnButton.disabled = true;
        return;
    }
    console.log(`Player ${localPlayerId} BUSTED. Updating Firestore.`);
    if(activePlayerId === localPlayerId) { // バストしたのは自分自身
      myTurnJustEndedAndBusted = true;
    }
    const roomRef = db.collection('rooms').doc(currentRoomId);
    try {
        await db.runTransaction(async (transaction) => {
            const roomDoc = await transaction.get(roomRef);
            if (!roomDoc.exists) throw "Room not found during bust!";
            const roomData = roomDoc.data();
            const nextPlayerId = getNextPlayerId(roomData.players, roomData.activePlayerId); // バストしたプレイヤーの次のプレイヤー
            transaction.update(roomRef, {
                activePlayerId: nextPlayerId,
                turnDiceRoll: [], turnTemporaryMarkers: [], turnChosenSums: [],
                turnBusted: true
            });
        });
        console.log("Bust processed in Firestore.");
         // バストのアラートは、自分のアクションでバストした場合に表示
        if(activePlayerId === localPlayerId) { // このチェックはFirestore更新前なので注意。
             alert("バスト！このターンの進行は失われました。");
        }
    } catch (error) {
        console.error("Error handling bust in Firestore: ", error);
    }
}

/**
 * 指定したトラックが他のプレイヤーに占領されているか
 */
function isTrackClaimedByOther(trackNumber, currentPlayerId) {
    return claimedTracks[trackNumber] && claimedTracks[trackNumber] !== currentPlayerId;
}

/**
 * 勝利条件のチェック
 */
function checkWinCondition(playerId) {
    const player = players.find(p => p.id === playerId);
    // occupiedTracksCount は Firestore から同期された player オブジェクト内にあるはず
    if (player && player.occupiedTracksCount >= 3) {
        console.log(`Player ${playerId} meets win condition with ${player.occupiedTracksCount} tracks.`);
        return true;
    }
    return false;
}

// --- イベントリスナー ---
createRoomButton.addEventListener('click', createRoom);
joinRoomButton.addEventListener('click', joinRoom);
startGameButton.addEventListener('click', startGame);
rollDiceButton.addEventListener('click', rollDice);
stopTurnButton.addEventListener('click', stopTurn);
continueTurnButton.addEventListener('click', continueTurn);

// --- 初期化処理 ---
drawGameBoard();
updatePlayersList();
updateCurrentPlayerDisplay();
rollDiceButton.disabled = true;
stopTurnButton.disabled = true;
continueTurnButton.disabled = true;
console.log("script.js loaded and initial setup complete.");

// Firestoreのルーム更新をリッスンする関数
let roomUnsubscribe = null;
function listenToRoomUpdates(roomId) {
    if (typeof db === 'undefined') {
        console.error("Firestore (db) is not initialized. Cannot listen to room updates.");
        return;
    }
    if (roomUnsubscribe) {
        console.log("Unsubscribing from previous room listener.");
        roomUnsubscribe();
    }
    console.log(`Listening to room ${roomId} for updates...`);
    roomUnsubscribe = db.collection('rooms').doc(roomId)
        .onSnapshot((doc) => {
            if (doc.exists) {
                const roomData = doc.data();
                console.log("Room data snapshot received: ", roomData);

                const previousActivePlayerForBustCheck = activePlayerId; // バスト通知のための直前のターンプレイヤー

                players = Object.values(roomData.players || {}).sort((a,b) => a.joinOrder - b.joinOrder);
                activePlayerId = roomData.activePlayerId;
                claimedTracks = roomData.claimedTracks || {};
                tempMarkersOnBoard = (roomData.activePlayerId === localPlayerId) ? (roomData.turnTemporaryMarkers || []) : [];

                updatePlayersList();
                updateCurrentPlayerDisplay();
                updateBoardMarkers();

                const myTurn = roomData.activePlayerId === localPlayerId;

                if (roomData.status === 'playing') {
                    roomManagementDiv.style.display = 'none';
                    gameAreaDiv.style.display = 'block';
                    startGameButton.disabled = true;

                    if (roomData.turnBusted && previousActivePlayerForBustCheck === localPlayerId && !myTurn) {
                        // 自分がバストしてターンが移ったことを検知
                         if(myTurnJustEndedAndBusted){ //自分のアクションでバストした場合のフラグ
                            // alert("バスト！あなたの進行は失われました。"); // handleBust内で表示するので重複を避ける
                            console.log("Confirmed: Your turn ended with a bust.");
                            myTurnJustEndedAndBusted = false; // フラグをリセット
                         }
                    }

                    rollDiceButton.disabled = !myTurn || (roomData.turnDiceRoll && roomData.turnDiceRoll.length > 0);
                    const canStopOrContinue = myTurn && (roomData.turnDiceRoll && roomData.turnDiceRoll.length > 0) && !roomData.turnBusted;
                    stopTurnButton.disabled = !canStopOrContinue;
                    continueTurnButton.disabled = !canStopOrContinue;

                    if (myTurn && roomData.turnDiceRoll && roomData.turnDiceRoll.length > 0 && !roomData.turnBusted) {
                        diceResultsDiv.innerHTML = '';
                        roomData.turnDiceRoll.forEach(roll => {
                            const diceDiv = document.createElement('div');
                            diceDiv.classList.add('dice'); diceDiv.textContent = roll;
                            diceResultsDiv.appendChild(diceDiv);
                        });
                        if (diceCombinationAreaDiv.style.display === 'none' && (!roomData.turnChosenSums || roomData.turnChosenSums.length === 0) ) {
                             generateDiceCombinations(roomData.turnDiceRoll);
                        } else if (roomData.turnChosenSums && roomData.turnChosenSums.length > 0) {
                             diceCombinationAreaDiv.style.display = 'block';
                             const comboSelectBtn = diceCombinationAreaDiv.querySelector('button');
                             if(comboSelectBtn) comboSelectBtn.disabled = true;
                        }
                    } else {
                        diceResultsDiv.innerHTML = '';
                        diceCombinationAreaDiv.style.display = 'none';
                    }
                } else if (roomData.status === 'waiting') {
                    roomManagementDiv.style.display = 'block';
                    gameAreaDiv.style.display = 'none';
                    const amIHost = roomData.hostPlayerId === localPlayerId;
                    const playerCount = Object.keys(roomData.players).length;
                    startGameButton.disabled = !(amIHost && playerCount >= 2 && playerCount <= 4);
                    startGameButton.style.display = amIHost ? 'inline-block' : 'none';
                } else if (roomData.status === 'finished') {
                    roomManagementDiv.style.display = 'none';
                    gameAreaDiv.style.display = 'block';
                    rollDiceButton.disabled = true; stopTurnButton.disabled = true; continueTurnButton.disabled = true;
                    diceResultsDiv.innerHTML = ''; diceCombinationAreaDiv.style.display = 'none';
                    const winner = players.find(p => p.id === roomData.winnerId);
                    if (winner) {
                        currentPlayerSpan.innerHTML = `勝者: <strong style="color:${winner.color};">${winner.name}</strong> さん！おめでとうございます！`;
                        if(localPlayerId === roomData.winnerId || !doc.metadata.hasPendingWrites){ //自分が勝者か、他のプレイヤーの更新ならアラート
                             alert(`ゲーム終了！ 勝者は ${winner.name} さんです！`);
                        }
                    } else {
                        currentPlayerSpan.textContent = "ゲーム終了";
                        if(!doc.metadata.hasPendingWrites) alert("ゲーム終了！");
                    }
                }
                previousActivePlayerId = roomData.activePlayerId; // 常に最後に更新
            } else {
                console.log("Room data no longer exists or access denied.");
                alert("部屋の情報が見つからないか、アクセスが拒否されました。ロビーに戻ります。");
                if (roomUnsubscribe) { roomUnsubscribe(); roomUnsubscribe = null; }
                roomManagementDiv.style.display = 'block'; gameAreaDiv.style.display = 'none';
                currentRoomId = null; localPlayerId = null;
                players = []; activePlayerId = null; claimedTracks = {}; tempMarkersOnBoard = [];
                updatePlayersList(); updateCurrentPlayerDisplay(); updateBoardMarkers();
            }
        }, (error) => {
            console.error("Error listening to room updates: ", error);
        });
}
