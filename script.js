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
// Note: HTMLのID変更に合わせて更新が必要 (例: createRoomButton -> create-room-btn)
// このサブタスクではdrawGameBoardに集中するため、他は一旦そのまま
const playerNameInput = document.getElementById('player-name'); // HTMLに合わせて host-name or client-name を使うべき
const createRoomButton = document.getElementById('create-room-btn'); // ID変更: create-room -> create-room-btn
const roomIdDisplay = document.getElementById('room-id-display'); // 追加
const roomIdInput = document.getElementById('room-id-input'); // ID変更: room-id -> room-id-input
const joinRoomButton = document.getElementById('join-room-btn'); // ID変更: join-room -> join-room-btn
const startGameButton = document.getElementById('start-game-btn'); // ID変更: start-game -> start-game-btn

const roomManagementDiv = document.getElementById('room-management');
const gameInfoDiv = document.getElementById('game-info'); //追加 (game-areaから分離)
const currentPlayerDisplay = document.getElementById('current-player-display'); // ID変更
const messageDisplay = document.getElementById('message-display'); // 追加
const playerListAreaDiv = document.getElementById('player-list-area'); // 追加
const playerListUl = document.getElementById('player-list'); // ID変更 playersListDiv -> playerListUl

const gameBoardDiv = document.getElementById('game-board');
const diceAreaDiv = document.getElementById('dice-area'); //追加
const diceResultDisplay = document.getElementById('dice-result-display'); // ID変更 diceResultsDiv -> diceResultDisplay
const rollDiceButton = document.getElementById('roll-dice-btn'); // ID変更 roll-dice -> roll-dice-btn

const actionAreaDiv = document.getElementById('action-area'); // 追加
const diceCombinationChoiceArea = document.getElementById('dice-combination-choice-area'); // 追加
const stopButton = document.getElementById('stop-btn'); // ID変更 stop-turn -> stop-btn

// 古いIDの変数はコメントアウトまたは削除 (必要に応じて新しいIDで再宣言)
// const gameAreaDiv = document.getElementById('game-area'); // game-info, game-boardなどに分割された
// const currentPlayerSpan = document.querySelector('#current-player span'); // currentPlayerDisplay を使用
// const playersListDiv = document.getElementById('players-list'); // playerListUl を使用
// const diceResultsDiv = document.getElementById('dice-results'); // diceResultDisplay を使用
// const diceCombinationAreaDiv = document.getElementById('dice-combination-area'); // diceCombinationChoiceArea を使用
// const diceCombinationsDiv = document.getElementById('dice-combinations'); // diceCombinationChoiceArea の子要素として管理
// const stopTurnButton = document.getElementById('stop-turn'); // stopButton を使用
// const continueTurnButton = document.getElementById('continue-turn'); // 未使用 or rollDiceButtonで兼用

// --- ゲーム設定 ---
const MAX_PLAYERS = 4; // 最大プレイヤー数
const MIN_PLAYERS_TO_START = 2; // ゲーム開始に必要な最低プレイヤー数
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
    if (!gameBoardDiv) {
        console.error("Game board element not found!");
        return;
    }
    gameBoardDiv.innerHTML = ''; // 描画前にクリア

    // TRACK_CONFIGは既存の {2: 3, 3: 5, ...} 形式をそのまま使用
    // CSSでは .track クラスを使用しているので、それに合わせる
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

            // マスを生成 (1からnumCellsまで)
            // CSSのflex-direction: column-reverse; を利用するため、
            // HTML上は1番目のマス(Can't Stopスペース)が最初に来るようにする
            for (let i = 1; i <= numCells; i++) {
                const cellDiv = document.createElement('div');
                cellDiv.classList.add('cell');
                cellDiv.dataset.track = trackNumber;
                cellDiv.dataset.cellPosition = i; // マス目の位置 (1から)

                if (i === 1) { // 最初のマス
                    cellDiv.classList.add('cant-stop-space');
                    // cellDiv.textContent = 'CS'; // CSSで装飾するので不要かも
                }
                if (i === numCells) { // 最後のマス
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
    console.log("Game board drawn with new structure.");
}

/**
 * 部屋を作成する処理
 */
async function createRoom() {
    // DOM要素のIDが変更されたため、対応する変数を参照するように注意
    // 例: playerNameInput -> hostNameInput (仮の変数名)
    const hostNameInput = document.getElementById('host-name');
    if (!hostNameInput) { console.error("#host-name not found"); return; }
    currentPlayerName = hostNameInput.value.trim();

    if (!currentPlayerName) {
        alert("あなたの名前（ホスト名）を入力してください。");
        if (messageDisplay) messageDisplay.textContent = "ホスト名を入力してください。";
        return;
    }
    if (typeof db === 'undefined') {
        alert("データベースに接続できません。Firebaseの設定を確認してください。");
        if (messageDisplay) messageDisplay.textContent = "データベース接続エラー。";
        return;
    }

    localPlayerId = generatePlayerId();
    currentRoomId = generateRoomId();

    const playerObject = {
        id: localPlayerId,
        name: currentPlayerName,
        color: PLAYER_COLORS[0], // Host is always the first color
        joinOrder: 1,
        isHost: true,
        occupiedTracksCount: 0,
    };

    const roomData = {
        roomId: currentRoomId, // Store roomId also in the document
        hostName: currentPlayerName,
        hostId: localPlayerId,
        players: { [localPlayerId]: playerObject }, // Players stored as a map
        status: "waiting", // "waiting", "playing", "finished"
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        maxPlayers: MAX_PLAYERS,
        currentTurnPlayerId: null,
        // gameBoardState: {}, // Initialize later if needed
        // diceValues: [],      // Initialize later if needed
        // turnTemporaryMarkers: [], // Already in existing code, keep it
        // claimedTracks: {},      // Already in existing code, keep it
        // winnerId: null,         // Already in existing code, keep it
        // turnDiceRoll: [],       // Already in existing code, keep it
        // turnChosenSums: [],     // Already in existing code, keep it
        // turnBusted: false,      // Consider adding this
    };
    try {
        await db.collection('rooms').doc(currentRoomId).set(roomData);
        console.log(`Room created in Firestore with ID: ${currentRoomId} by ${localPlayerId}`);
        if(roomIdDisplay) roomIdDisplay.textContent = currentRoomId; // 部屋ID表示を更新
        players = [playerObject]; // 自分の情報をローカルのplayers配列に追加
        alert(`部屋が作成されました。部屋ID: ${currentRoomId}`);

        // UI表示切替
        // UI表示切替: 部屋管理を隠し、ゲーム情報関連を表示
        showGameRelatedUI(true); // true for host


        listenToRoomUpdates(currentRoomId);
    } catch (error) {
        console.error("Error creating room: ", error);
        alert("部屋の作成に失敗しました。");
        currentRoomId = null;
        localPlayerId = null;
    }
}

/**
 * 部屋に参加する処理
 */
async function joinRoom() {
    // DOM要素のIDが変更されたため、対応する変数を参照するように注意
    const clientNameInput = document.getElementById('client-name');
    if (!clientNameInput) { console.error("#client-name not found"); return; }
    currentPlayerName = clientNameInput.value.trim();

    if (!roomIdInput) { console.error("#room-id-input not found"); return; }
    const roomIdToJoin = roomIdInput.value.trim().toUpperCase();

    if (!currentPlayerName) {
        alert("あなたの名前（参加者名）を入力してください。");
        if (messageDisplay) messageDisplay.textContent = "参加者名を入力してください。";
        return;
    }
    if (!roomIdToJoin) {
        alert("参加する部屋IDを入力してください。");
        if (messageDisplay) messageDisplay.textContent = "部屋IDを入力してください。";
        return;
    }
    if (typeof db === 'undefined') {
        alert("データベースに接続できません。Firebaseの設定を確認してください。");
        if (messageDisplay) messageDisplay.textContent = "データベース接続エラー。";
        return;
    }

    try {
        const roomRef = db.collection('rooms').doc(roomIdToJoin);
        const roomDoc = await roomRef.get();

        if (!roomDoc.exists) {
            alert("指定された部屋IDの部屋が見つかりません。");
            if (messageDisplay) messageDisplay.textContent = `部屋ID ${roomIdToJoin} が見つかりません。`;
            return;
        }

        const roomData = roomDoc.data();
        const numPlayers = Object.keys(roomData.players).length;

        if (numPlayers >= (roomData.maxPlayers || MAX_PLAYERS)) {
            alert("この部屋は満員です。");
            if (messageDisplay) messageDisplay.textContent = `部屋 ${roomIdToJoin} は満員です。`;
            return;
        }
        if (roomData.status !== "waiting") {
            alert("このゲームは既に開始されているか終了しています。");
            if (messageDisplay) messageDisplay.textContent = `部屋 ${roomIdToJoin} は現在参加できません。`;
            return;
        }
        // 同じ名前のプレイヤーが既にいないかチェック (簡易的)
        if (Object.values(roomData.players).some(p => p.name === currentPlayerName)) {
            alert("同じ名前のプレイヤーが既に部屋にいます。別の名前を入力してください。");
            if (messageDisplay) messageDisplay.textContent = "その名前は既に使用されています。";
            return;
        }


        localPlayerId = generatePlayerId();
        const playerObject = {
            id: localPlayerId,
            name: currentPlayerName,
            color: PLAYER_COLORS[numPlayers], // 参加順で色を決定
            joinOrder: numPlayers + 1,
            isHost: false,
            occupiedTracksCount: 0
        };
        await roomRef.update({
            [`players.${localPlayerId}`]: playerObject
        });
        currentRoomId = roomIdToJoin;
        console.log(`${currentPlayerName} joined room: ${currentRoomId}`);
        alert(`部屋 ${currentRoomId} に参加しました。`);

        // UI表示切替: 部屋管理を隠し、ゲーム情報関連を表示
        showGameRelatedUI(false); // false for non-host

        listenToRoomUpdates(currentRoomId);
    } catch (error) {
        console.error("Error joining room: ", error);
        alert("部屋への参加に失敗しました。\n" + error.message);
        if (messageDisplay) messageDisplay.textContent = "部屋参加エラー: " + error.message;
        localPlayerId = null; // Reset local player ID on failure
        currentRoomId = null; // Reset current room ID
    }
}

/**
 * ゲームを開始する処理
 */
async function startGame() {
    if (typeof db === 'undefined' || !currentRoomId) {
        alert("データベースに接続されていないか、部屋が存在しません。"); return;
    }
    if (!currentRoomId || !localPlayerId) {
        alert("部屋に参加していません。");
        return;
    }
    const roomRef = db.collection('rooms').doc(currentRoomId);
    try {
        const roomDoc = await roomRef.get();
        if (!roomDoc.exists) {
            alert("部屋のデータが見つかりません。");
            if (messageDisplay) messageDisplay.textContent = "部屋データが見つかりません。";
            return;
        }
        const roomData = roomDoc.data();

        // ホストであるか確認 (追加のセキュリティチェック)
        if (roomData.hostId !== localPlayerId) {
            alert("ホストプレイヤーのみがゲームを開始できます。");
            if (messageDisplay) messageDisplay.textContent = "ホストのみ開始可能です。";
            return;
        }

        const numPlayers = Object.keys(roomData.players).length;
        if (numPlayers < MIN_PLAYERS_TO_START) {
            alert(`ゲームを開始するには最低${MIN_PLAYERS_TO_START}人のプレイヤーが必要です。現在${numPlayers}人です。`);
            if (messageDisplay) messageDisplay.textContent = `最低${MIN_PLAYERS_TO_START}人が必要です。`;
            return;
        }

        // 最初のプレイヤーを決定 (参加順 joinOrder が最も小さいプレイヤー)
        let firstPlayerId = null;
        let minJoinOrder = Infinity;
        for (const pId in roomData.players) {
            if (roomData.players[pId].joinOrder < minJoinOrder) {
                minJoinOrder = roomData.players[pId].joinOrder;
                firstPlayerId = pId;
            }
        }

        if (!firstPlayerId) {
            alert("最初のプレイヤーを決定できませんでした。");
            if (messageDisplay) messageDisplay.textContent = "開始プレイヤーエラー。";
            return;
        }

        await roomRef.update({
            status: "playing",
            activePlayerId: firstPlayerId,
            // ゲーム開始時にリセットまたは初期化するフィールド
            turnDiceRoll: [],
            turnTemporaryMarkers: [],
            turnChosenSums: [],
            turnBusted: false,
            claimedTracks: {},
            winnerId: null,
            // gameBoardState: initialGameBoardState() // 必要なら初期ボード状態を設定
        });
        console.log("Game started in Firestore! First turn:", firstPlayerId);
        if (messageDisplay) messageDisplay.textContent = `ゲーム開始！ ${roomData.players[firstPlayerId].name}さんのターン。`;
    } catch (error) {
        console.error("Error starting game: ", error);
        alert("ゲームの開始に失敗しました。\n" + error.message);
        if (messageDisplay) messageDisplay.textContent = "ゲーム開始エラー: " + error.message;
    }
}

/**
 * プレイヤーリスト表示を更新
 */
function updatePlayersList() {
    if (!playerListUl) return;
    playerListUl.innerHTML = ''; // リストをクリア
    players.forEach((p, index) => { // index を使って色クラスを割り当てる
        const li = document.createElement('li');
        li.textContent = p.name;
        // プレイヤーの色に対応するCSSクラスを適用 (例: player-color-0, player-color-1)
        // PLAYER_COLORS配列のインデックスと合わせるため、playerIndex を使う
        const playerColorIndex = PLAYER_COLORS.indexOf(p.color);
        if (playerColorIndex !== -1) {
            li.classList.add(`player-color-${playerColorIndex}`);
        } else { // PLAYER_COLORSにない色の場合 (フォールバック)
            li.style.color = p.color;
        }
        if (p.id === localPlayerId) {
            li.textContent += " (あなた)";
            li.style.fontWeight = 'bold';
        }
        playerListUl.appendChild(li);
    });
}

/**
 * 現在のターンプレイヤー表示を更新
 */
function updateCurrentPlayerDisplay() {
    if (!currentPlayerDisplay) return;
    if (activePlayerId) {
        const activeP = players.find(p => p.id === activePlayerId);
        currentPlayerDisplay.textContent = activeP ? activeP.name : '未定';
        if (activeP && activeP.id === localPlayerId) {
            currentPlayerDisplay.textContent += " (あなたのターン)";
            currentPlayerDisplay.style.fontWeight = 'bold';
        } else if (activeP) {
             currentPlayerDisplay.style.fontWeight = 'normal';
        }
    } else {
        currentPlayerDisplay.textContent = 'ゲーム開始前';
        currentPlayerDisplay.style.fontWeight = 'normal';
    }
}

/**
 * ダイス結果表示を更新
 */
function updateDiceResultDisplay(diceRolls) {
    if (!diceResultDisplay) return;
    diceResultDisplay.innerHTML = ''; // クリア
    if (diceRolls && diceRolls.length > 0) {
        diceRolls.forEach(roll => {
            const diceValueSpan = document.createElement('span');
            diceValueSpan.classList.add('dice-value');
            diceValueSpan.textContent = roll;
            diceResultDisplay.appendChild(diceValueSpan);
        });
    } else {
        diceResultDisplay.textContent = '-'; // ダイスが振られていない場合
    }
}

/**
 * ダイスを振る処理
 */
async function rollDice() {
    if (typeof db === 'undefined' || !currentRoomId || !localPlayerId) {
        alert("ゲームに参加していません。");
        if (messageDisplay) messageDisplay.textContent = "ゲームに参加していません。";
        return;
    }
    const roomRef = db.collection('rooms').doc(currentRoomId);
    try {
        const roomDoc = await roomRef.get();
        if (!roomDoc.exists) {
            alert("部屋のデータが見つかりません。");
            if (messageDisplay) messageDisplay.textContent = "部屋データエラー。";
            return;
        }
        const roomData = roomDoc.data();

        if (roomData.status !== "playing") {
            alert("ゲームが進行中ではありません。");
            return;
        }
        if (roomData.activePlayerId !== localPlayerId) {
            alert("あなたのターンではありません。");
            return;
        }

        const updates = {};
        // 「続ける」場合: 既にダイスが振られ、マーカーが置かれている状態
        // この場合はダイス関連情報のみリセットして新しいダイスを振る準備
        if (roomData.turnDiceRoll && roomData.turnDiceRoll.length > 0 &&
            Object.keys(roomData.turnTemporaryMarkers || {}).length > 0 &&
            !roomData.turnBusted) {
            updates.turnDiceRoll = [];
            updates.turnChosenSums = [];
            updates.turnBusted = false;
            // turnTemporaryMarkers は維持
             console.log("Continuing turn, resetting dice info.");
        } else if (roomData.turnDiceRoll && roomData.turnDiceRoll.length > 0) {
             alert("既にダイスは振られています。組み合わせを選択するかストップしてください。");
             return;
        }


        // 新しいダイスを振る (最初のロールまたはリセット後のロール)
        const diceResults = [];
        for (let i = 0; i < 4; i++) {
            diceResults.push(Math.floor(Math.random() * 6) + 1);
        }
        updates.turnDiceRoll = diceResults;
        // 最初のロールの場合、他のフィールドもリセットする（既にupdatesでリセットされている場合もあるが念のため）
        updates.turnChosenSums = [];
        updates.turnBusted = false;
        // 最初のロールの場合、turnTemporaryMarkersは前のターンのものがクリアされているか、空のはず。
        // 「続ける」の場合は維持されているので、ここでは変更しない。
        // もし最初のロールなら、前のプレイヤーのマーカーが残っている可能性はないはず（ターン終了時にクリアされるため）
        // updates.turnTemporaryMarkers = {}; // ←これは「続ける」の場合にリセットしてしまうので不適切

        await roomRef.update(updates);
        console.log("Dice rolled/reset and results stored in Firestore:", updates);

    } catch (error) {
        console.error("Error in rollDice: ", error);
        alert("ダイス処理に失敗しました。\n" + error.message);
        if (messageDisplay) messageDisplay.textContent = "ダイス処理エラー: " + error.message;
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
    // dice (array of 4 numbers)
    if (!dice || dice.length !== 4) {
        console.error("generateDiceCombinations: Invalid dice array provided.", dice);
        if (diceCombinationChoiceArea) {
            diceCombinationChoiceArea.innerHTML = '<p>ダイス情報が正しくありません。</p>';
            diceCombinationChoiceArea.classList.remove('hidden');
        }
        return;
    }

    const allCombinationsInput = [
        [[dice[0], dice[1]], [dice[2], dice[3]]], // (d1+d2), (d3+d4)
        [[dice[0], dice[2]], [dice[1], dice[3]]], // (d1+d3), (d2+d4)
        [[dice[0], dice[3]], [dice[1], dice[2]]]  // (d1+d4), (d2+d3)
    ];

    const uniqueSumPairs = [];
    const seenPairKeys = new Set();

    allCombinationsInput.forEach(comboGroup => {
        const sum1 = comboGroup[0][0] + comboGroup[0][1];
        const sum2 = comboGroup[1][0] + comboGroup[1][1];
        // ソートしてキーにすることで、[3,7] と [7,3] を同じとみなす (ただし、キャントストップでは順番も意味を持つことがあるので、ここではそのまま扱う)
        // const key = [sum1, sum2].sort().join(',');
        // キャントストップのルールでは、2つのサイコロのペアの合計値が重要なので、ペアの順番は関係ない。
        // しかし、(1+2)=3, (3+4)=7 と (3+4)=7, (1+2)=3 は同じ選択肢。
        // ここでは、生成される3つの組み合わせグループがユーザーにとって異なる選択肢として提示されることを重視。

        // 提示する文字列と実際の値(sum1, sum2)を保持
        // comboGroup[0] は最初のペアのダイス目, comboGroup[1] は2番目のペアのダイス目
        const displayString = `(${comboGroup[0].join('+')}=${sum1} と ${comboGroup[1].join('+')}=${sum2})`;
        const value = [sum1, sum2]; // 保存する値

        // 全く同じ組み合わせ (例: 1,1,2,2 のダイスで (1+1)=2, (2+2)=4 が複数回生成される場合) は避ける
        const keyForUniqueness = value.slice().sort((a,b)=>a-b).join(','); // [2,4] のようなキー
        if (!seenPairKeys.has(keyForUniqueness)) {
            uniqueSumPairs.push({ display: displayString, value: value, originalDicePairs: comboGroup });
            seenPairKeys.add(keyForUniqueness);
        }
    });

    if (diceCombinationChoiceArea) {
        diceCombinationChoiceArea.innerHTML = ''; // クリア
        if (uniqueSumPairs.length > 0) {
            uniqueSumPairs.forEach((combo, index) => {
                const label = document.createElement('label');
                const radio = document.createElement('input');
                radio.type = 'radio';
                radio.name = 'diceCombination';
                radio.value = index; // インデックスで選択を識別
                // データセットに実際の合計値ペアを文字列として保存 (例: "3,7")
                radio.dataset.chosenSums = combo.value.join(',');
                label.appendChild(radio);
                label.append(` ${combo.display}`);
                diceCombinationChoiceArea.appendChild(label);
                diceCombinationChoiceArea.appendChild(document.createElement('br'));
            });

            const selectButton = document.createElement('button');
            selectButton.id = 'confirm-combination-btn'; // ID付与
            selectButton.textContent = 'この組み合わせで進む';
            selectButton.onclick = selectDiceCombination; // 既存の関数名に合わせる
            diceCombinationChoiceArea.appendChild(selectButton);
        } else {
            diceCombinationChoiceArea.innerHTML = '<p>有効なダイスの組み合わせがありません。</p>';
            // この場合、ルールによってはバスト扱いになるが、それは selectDiceCombination や上位のロジックで判断
            console.warn("No unique dice combinations found for dice:", dice);
             // 進行不能なので自動的にバスト処理を呼び出すことを検討
            if(localPlayerId === activePlayerId && roomData.status === "playing") { // roomDataはどこから？ listenToRoomUpdatesから渡す必要がある
                 // handleBust(); // すぐにバストにするか、プレイヤーに通知するか
                 // ここで直接 roomData を参照できないので、この関数の呼び出し元でバスト処理を検討する
            }
        }
        diceCombinationChoiceArea.classList.remove('hidden');
    }
    console.log("Dice combinations generated and displayed:", uniqueSumPairs);
}

/**
 * 選択されたダイスの組み合わせでマーカーを進める処理
 */
// `selectDiceCombination` はダイスペア選択後のマーカー進行ロジックを含むように拡張
async function selectDiceCombination() {
    if (typeof db === 'undefined' || !currentRoomId || !localPlayerId) {
        alert("ゲームに参加していません。");
        if (messageDisplay) messageDisplay.textContent = "ゲームに参加していません。";
        return;
    }

    const selectedRadio = document.querySelector('input[name="diceCombination"]:checked');
    if (!selectedRadio) {
        alert("ダイスの組み合わせを選択してください。");
        if (messageDisplay) messageDisplay.textContent = "組み合わせを選択してください。";
        return;
    }

    const chosenSumsString = selectedRadio.dataset.chosenSums;
    const chosenSums = chosenSumsString.split(',').map(s => parseInt(s.trim()));

    if (!chosenSums || chosenSums.length !== 2) {
        console.error("Invalid chosen combination:", chosenSums);
        alert("選択された組み合わせが無効です。");
        return;
    }

    const roomRef = db.collection('rooms').doc(currentRoomId);

    try {
        const roomDoc = await roomRef.get();
        if (!roomDoc.exists) throw new Error("Room not found!");

        let roomData = roomDoc.data();

        if (roomData.activePlayerId !== localPlayerId) { alert("あなたのターンではありません。"); return; }
        if (!roomData.turnDiceRoll || roomData.turnDiceRoll.length === 0) { alert("まだダイスが振られていません。"); return; }
        if (roomData.turnChosenSums && roomData.turnChosenSums.length > 0) { alert("既に組み合わせは選択済みです。"); return; }

        let currentTurnTempMarkers = JSON.parse(JSON.stringify(roomData.turnTemporaryMarkers || {}));
        const claimedCols = roomData.claimedColumns || {};
        let canAdvanceAnyMarker = false;
        let isBust = false;

        function canPlaceOrAdvanceOnTrack(trackSum) {
            if (trackSum < 2 || trackSum > 12) return false;
            if (claimedCols[trackSum] && claimedCols[trackSum] !== localPlayerId) return false;
            if (claimedCols[trackSum] && claimedCols[trackSum] === localPlayerId) return false;
            const currentMarkerPosition = currentTurnTempMarkers[trackSum];
            if (currentMarkerPosition && currentMarkerPosition >= TRACK_CONFIG[trackSum]) return false;
            const tempMarkerCount = Object.keys(currentTurnTempMarkers).length;
            if (!currentMarkerPosition && tempMarkerCount >= 3) return false;
            return true;
        }

        // chosenSums は [sum1, sum2] の形
        const uniqueChosenSums = chosenSums[0] === chosenSums[1] ? [chosenSums[0]] : chosenSums;

        for (const sum of uniqueChosenSums) {
            if (canPlaceOrAdvanceOnTrack(sum)) {
                if (currentTurnTempMarkers[sum]) {
                    currentTurnTempMarkers[sum]++;
                } else {
                    currentTurnTempMarkers[sum] = 1;
                }
                canAdvanceAnyMarker = true;
            }
        }

        if (!canAdvanceAnyMarker) {
            isBust = true;
            if (messageDisplay) messageDisplay.textContent = "バスト！選択した組み合わせでは進めません。";
            console.log("Player busted. No valid moves for chosen sums.");
        }

        const updatesForFirestore = {
            turnChosenSums: chosenSums,
            turnTemporaryMarkers: isBust ? {} : currentTurnTempMarkers,
            turnBusted: isBust,
        };

        if (isBust) {
            updatesForFirestore.activePlayerId = getNextPlayerId(roomData);
            updatesForFirestore.turnDiceRoll = []; // Reset for next player
            updatesForFirestore.turnChosenSums = []; // Reset for next player
            // turnTemporaryMarkers is already reset above
        }

        await roomRef.update(updatesForFirestore);

        if (!isBust && messageDisplay) {
            messageDisplay.textContent = `組み合わせ ${chosenSums.join(' と ')} を選択。マーカー更新。`;
        }
        console.log("Combination processed. Updates:", updatesForFirestore);

    } catch (error) {
        console.error("Error in selectDiceCombination (advancing markers): ", error);
        alert("マーカー進行処理に失敗しました。\n" + error.message);
        if (messageDisplay) messageDisplay.textContent = "マーカー進行エラー: " + error.message;
    }
}

// This function is now integrated into selectDiceCombination's logic
// function attemptAdvance(trackNumber, tempMarkers, playerId) { ... }

// This function is now integrated into selectDiceCombination's logic
// function canAdvanceOnTrack(trackNumber, currentTempMarkers, claimedTracksByAny, playerId) { ... }
// } // selectDiceCombination の閉じ括弧だったが、上記コメントアウトにより不要になった


/**
 * ボード上のマーカー表示を全体的に更新する
 */
function updateBoardMarkers(roomData) { // roomData を引数として受け取る
    if (!gameBoardDiv) return;
    // 既存のマーカーを全てクリア
    gameBoardDiv.querySelectorAll('.temp-marker, .claim-marker').forEach(m => m.remove());

    if (!gameBoardDiv || !roomData) return;
    gameBoardDiv.querySelectorAll('.temp-marker, .claim-marker').forEach(m => m.remove());

    const getPlayerColorClass = (pId) => {
        const player = roomData.players[pId]; // Assuming players is a map { id: playerObject }
        if (player && player.color) {
            const colorIndex = PLAYER_COLORS.indexOf(player.color);
            return colorIndex !== -1 ? `player${colorIndex}` : 'player-default';
        }
        // Fallback if player or color not found, or if players is an array
        const playerFromArray = players.find(p => p.id === pId);
         if (playerFromArray && playerFromArray.color) {
            const colorIndex = PLAYER_COLORS.indexOf(playerFromArray.color);
            return colorIndex !== -1 ? `player${colorIndex}` : 'player-default';
        }
        return 'player-default';
    };

    // Draw current turn's temporary markers
    if (roomData.activePlayerId && roomData.turnTemporaryMarkers) {
        const activePlayerColorClass = getPlayerColorClass(roomData.activePlayerId);
        for (const trackNumStr in roomData.turnTemporaryMarkers) {
            const position = roomData.turnTemporaryMarkers[trackNumStr];
            const trackSelector = `.track[data-track-number="${trackNumStr}"]`;
            const cellSelector = `${trackSelector} .cell[data-cell-position="${position}"]`;
            const cellToPlaceOn = gameBoardDiv.querySelector(cellSelector);

            if (cellToPlaceOn) {
                const markerDiv = document.createElement('div');
                markerDiv.classList.add('temp-marker', activePlayerColorClass);
                const markerContainer = cellToPlaceOn.querySelector('.marker-container');
                if (markerContainer) markerContainer.appendChild(markerDiv);
            }
        }
    }

    // Draw claimed columns (permanent markers)
    if (roomData.claimedColumns) {
        for (const trackNumStr in roomData.claimedColumns) {
            const pId = roomData.claimedColumns[trackNumStr];
            const claimedPlayerColorClass = getPlayerColorClass(pId);
            const goalPosition = TRACK_CONFIG[trackNumStr];

            const trackSelector = `.track[data-track-number="${trackNumStr}"]`;
            const cellSelector = `${trackSelector} .cell[data-cell-position="${goalPosition}"]`;
            const goalCell = gameBoardDiv.querySelector(cellSelector);

            if (goalCell) {
                const claimMarkerDiv = document.createElement('div');
                claimMarkerDiv.classList.add('claim-marker', claimedPlayerColorClass);
                const markerContainer = goalCell.querySelector('.marker-container');
                if (markerContainer) markerContainer.appendChild(claimMarkerDiv);
            }
        }
    }
    // console.log("Board markers updated based on roomData:", roomData); // Be cautious with logging full roomData
}

/**
 * ストップ処理
 */
async function stopTurn() {
    if (typeof db === 'undefined' || !currentRoomId || !localPlayerId) {
        alert("ゲームに参加していません。"); return;
    }

    const roomRef = db.collection('rooms').doc(currentRoomId);
    try {
        const roomDoc = await roomRef.get();
        if (!roomDoc.exists) throw new Error("Room not found!");
        let roomData = roomDoc.data();

        if (roomData.activePlayerId !== localPlayerId) {
            alert("あなたのターンではありません。"); return;
        }
        if (roomData.status !== "playing") {
            alert("ゲームは進行中ではありません。"); return;
        }
        if (roomData.turnBusted) {
            alert("バストしています。ストップできません（ターンは自動的に終了します）。"); return;
        }
        if (Object.keys(roomData.turnTemporaryMarkers || {}).length === 0) {
            alert("進めたマーカーがありません。ダイスを振るか、有効な組み合わせを選んでください。"); return;
        }

        let updatedClaimedColumns = { ...(roomData.claimedColumns || {}) };
        let newColumnsClaimedThisTurn = 0;

        for (const colStr in roomData.turnTemporaryMarkers) {
            const position = roomData.turnTemporaryMarkers[colStr];
            const trackGoal = TRACK_CONFIG[colStr];
            if (position >= trackGoal && !updatedClaimedColumns[colStr]) { // ゴールに到達していて、まだ誰も占領していない
                updatedClaimedColumns[colStr] = localPlayerId;
                newColumnsClaimedThisTurn++;
            }
        }

        // プレイヤーごとの占領列数を更新 (Firestoreのplayersマップを直接更新)
        // 注意: Firestoreの特定プレイヤーのフィールドを更新するには、そのプレイヤーの正確なIDが必要
        // roomData.players[localPlayerId] が存在することを期待
        let playerOccupiedCount = 0;
        if(roomData.players && roomData.players[localPlayerId]) {
            // まず現在の占領数を計算
             for (const col in updatedClaimedColumns) {
                if (updatedClaimedColumns[col] === localPlayerId) {
                    playerOccupiedCount++;
                }
            }
        }


        const updates = {
            claimedColumns: updatedClaimedColumns,
            currentTurnTemporaryMarkers: {}, // 一時マーカーをクリア
            turnDiceRoll: [],
            turnChosenSums: [],
            turnBusted: false,
            activePlayerId: getNextPlayerId(roomData), // 次のプレイヤーへ
            // [`players.${localPlayerId}.occupiedTracksCount`]: playerOccupiedCount, // Firestoreの特定プレイヤーフィールド更新
        };

        // 勝利条件のチェック
        if (playerOccupiedCount >= 3) { // 3列占領で勝利
            updates.status = "finished";
            updates.winnerId = localPlayerId;
            console.log(`Player ${localPlayerId} wins!`);
            if (messageDisplay) messageDisplay.textContent = `プレイヤー ${roomData.players[localPlayerId]?.name} の勝利！`;
        }


        await roomRef.update(updates);
        console.log("Turn stopped. Firestore updated. Next player:", updates.activePlayerId);
        if (messageDisplay && updates.status !== "finished") messageDisplay.textContent = "ターン終了。次のプレイヤーの番です。";

    } catch (error) {
        console.error("Error stopping turn: ", error);
        alert("ストップ処理に失敗しました。\n" + error.message);
        if (messageDisplay) messageDisplay.textContent = "ストップエラー: " + error.message;
    }
}

function getNextPlayerId(roomData) {
    if (!roomData || !roomData.players || !roomData.activePlayerId) return null;
    const playerIds = Object.keys(roomData.players).sort((a,b) => roomData.players[a].joinOrder - roomData.players[b].joinOrder);
    const currentIndex = playerIds.indexOf(roomData.activePlayerId);
    return playerIds[(currentIndex + 1) % playerIds.length];
}

// continueTurn は rollDiceButton のアクションに統合されるため、独立した関数としては不要になる
// async function continueTurn() { ... }


// handleBust は selectDiceCombination 内のロジックに統合
// バストが確定したら、selectDiceCombination がFirestoreに必要な更新（一時マーカークリア、次のプレイヤーなど）を行う
// async function handleBust() { ... }


// isTrackClaimedByOther は selectDiceCombination 内の canPlaceOrAdvance で同様のチェックを行う
// function isTrackClaimedByOther(trackNumber, currentPlayerId) { ... }

// checkWinCondition は stopTurn 内で直接処理
// function checkWinCondition(playerId) { ... }
}

// --- イベントリスナー ---
// HTMLのID変更に合わせて、イベントリスナーの対象も更新
if (createRoomButton) createRoomButton.addEventListener('click', createRoom);
if (joinRoomButton) joinRoomButton.addEventListener('click', joinRoom);
if (startGameButton) startGameButton.addEventListener('click', startGame);
if (rollDiceButton) rollDiceButton.addEventListener('click', rollDice);
if (stopButton) stopButton.addEventListener('click', stopTurn);
// continueTurnButton のリスナーは削除またはコメントアウト

// ヘルパー関数
function generatePlayerId() {
    return Math.random().toString(36).substr(2, 9);
}

function generateRoomId() {
    return Math.random().toString(36).substr(2, 6).toUpperCase();
}

function showGameRelatedUI(isHost) {
    if (roomManagementDiv) roomManagementDiv.classList.add('hidden'); // or .style.display = 'none'
    if (gameInfoDiv) gameInfoDiv.classList.remove('hidden');
    if (playerListAreaDiv) playerListAreaDiv.classList.remove('hidden');
    if (gameBoardDiv) gameBoardDiv.classList.remove('hidden'); // game-boardはflex displayなので注意
    if (diceAreaDiv) diceAreaDiv.classList.remove('hidden');
    if (actionAreaDiv) actionAreaDiv.classList.remove('hidden');

    if (startGameButton) {
        if (isHost) {
            startGameButton.classList.remove('hidden');
            startGameButton.disabled = false; // ホストは最初は有効（プレイヤー数チェックはstartGame関数内）
        } else {
            startGameButton.classList.add('hidden');
        }
    }
}

function showRoomManagementUI() {
    if (roomManagementDiv) roomManagementDiv.classList.remove('hidden');
    if (gameInfoDiv) gameInfoDiv.classList.add('hidden');
    if (playerListAreaDiv) playerListAreaDiv.classList.add('hidden');
    if (gameBoardDiv) gameBoardDiv.classList.add('hidden');
    if (diceAreaDiv) diceAreaDiv.classList.add('hidden');
    if (actionAreaDiv) actionAreaDiv.classList.add('hidden');
    if (startGameButton) startGameButton.classList.add('hidden');
    if (rollDiceButton) rollDiceButton.disabled = true;
    if (stopButton) stopButton.disabled = true;
    if (roomIdDisplay) roomIdDisplay.textContent = '';
    if (messageDisplay) messageDisplay.textContent = '';
}


// --- 初期化処理 ---
document.addEventListener('DOMContentLoaded', () => {
    drawGameBoard(); // ゲームボードを描画
    showRoomManagementUI(); // 初期は部屋管理UIのみ表示
    updatePlayersList(); // プレイヤーリスト初期化 (空のはず)
    updateCurrentPlayerDisplay(); // 現在のプレイヤー表示初期化
    updateDiceResultDisplay([]); // ダイス表示初期化
    console.log("script.js loaded and initial setup complete.");
});

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

                const previousActivePlayerForBustCheck = activePlayerId;

                players = Object.values(roomData.players || {}).sort((a,b) => a.joinOrder - b.joinOrder);
                activePlayerId = roomData.activePlayerId;
                claimedTracks = roomData.claimedTracks || {};
                // 一時マーカーは常にFirestoreの最新状態を参照 (自分のものだけでなくても良いかもしれないが、一旦このまま)
                tempMarkersOnBoard = roomData.turnTemporaryMarkers || [];


                updatePlayersList();
                updateCurrentPlayerDisplay();
                updateBoardMarkers(); // ボードマーカー更新はFirestoreデータに基づいて行う
                updateDiceResultDisplay(roomData.turnDiceRoll); // ダイス表示更新

                const myTurn = roomData.activePlayerId === localPlayerId;

                // メッセージ表示更新
                if (messageDisplay) {
                    if (roomData.status === 'playing') {
                        if (myTurn) {
                            messageDisplay.textContent = "あなたのターンです！";
                        } else {
                            const activeP = players.find(p => p.id === roomData.activePlayerId);
                            messageDisplay.textContent = activeP ? `${activeP.name}さんのターンです。` : "ゲームプレイ中";
                        }
                        if (roomData.turnBusted && roomData.activePlayerId !== previousActivePlayerForBustCheck) {
                             const bustedPlayer = players.find(p => p.id === previousActivePlayerForBustCheck);
                             if (bustedPlayer) {
                                messageDisplay.textContent = `${bustedPlayer.name}さんはバストしました。${myTurn ? "あなたのターンです！" : (players.find(p => p.id === roomData.activePlayerId)?.name || "") + "さんのターンです。"}`;
                             }
                        }
                    } else if (roomData.status === 'waiting') {
                        messageDisplay.textContent = "プレイヤーの参加を待っています...";
                    } else if (roomData.status === 'finished') {
                        // 勝利メッセージは後述
                    }
                }


                if (roomData.status === 'playing') {
                    showGameRelatedUI(roomData.hostId === localPlayerId); // isHostを渡す
                    if (startGameButton) startGameButton.classList.add('hidden'); // ゲーム中は開始ボタンを隠す


                    // UI更新をroomDataに基づいて行う
                    updatePlayersList(); // players はグローバル変数だが、roomData.players を使う方が良い場合もある
                    updateCurrentPlayerDisplay(); // activePlayerId はグローバル変数
                    updateBoardMarkers(roomData); // roomData を引数として渡す
                    updateDiceResultDisplay(roomData.turnDiceRoll);


                    const myTurn = roomData.activePlayerId === localPlayerId;

                    if (messageDisplay) { // メッセージ表示ロジック
                        if (roomData.turnBusted && roomData.activePlayerId === localPlayerId) { // 自分がバストした直後
                             messageDisplay.textContent = "バスト！あなたの進行はリセットされました。次のプレイヤーの番です。";
                             // このメッセージはターンが移るまで表示される
                        } else if (roomData.turnBusted && roomData.activePlayerId !== localPlayerId && previousActivePlayerForBustCheck === localPlayerId) {
                            //自分がバストしてターンが移った後 (この条件は少し複雑、必要なら調整)
                            messageDisplay.textContent = "あなたはバストしました。";
                        }
                        else if (roomData.status === 'playing') {
                            if (myTurn) messageDisplay.textContent = "あなたのターンです。";
                            else {
                                const activeP = players.find(p => p.id === roomData.activePlayerId);
                                messageDisplay.textContent = activeP ? `${activeP.name}さんのターンです。` : "ゲームプレイ中";
                            }
                        } else if (roomData.status === 'waiting') {
                            messageDisplay.textContent = "プレイヤーの参加を待っています...";
                        } // finished のメッセージは後で
                    }


                    if (roomData.status === 'playing') {
                        showGameRelatedUI(roomData.hostId === localPlayerId);
                        if (startGameButton) startGameButton.classList.add('hidden');

                        if (startGameButton) startGameButton.classList.add('hidden'); // ゲーム中は非表示

                        const isMyTurn = roomData.activePlayerId === localPlayerId;
                        const diceRolled = roomData.turnDiceRoll && roomData.turnDiceRoll.length > 0;
                        const combinationChosen = roomData.turnChosenSums && roomData.turnChosenSums.length > 0;
                        const isBusted = roomData.turnBusted;
                        const tempMarkersExist = Object.keys(roomData.turnTemporaryMarkers || {}).length > 0;

                        // ダイスを振る/続けるボタンの制御
                        if (rollDiceButton) {
                            // 最初のロール: 自分のターン、バストしてない、ダイスロール前
                            const canMakeFirstRoll = isMyTurn && !isBusted && !diceRolled;
                            // 続ける: 自分のターン、バストしてない、組み合わせ選択済み、マーカー進行済み
                            const canContinue = isMyTurn && !isBusted && diceRolled && combinationChosen && tempMarkersExist;
                            rollDiceButton.disabled = !(canMakeFirstRoll || canContinue);
                            rollDiceButton.textContent = (diceRolled && tempMarkersExist) ? '続ける' : 'ダイスを振る';
                        }

                        // ストップボタンの制御
                        if (stopButton) {
                            stopButton.disabled = !(isMyTurn && !isBusted && diceRolled && tempMarkersExist);
                        }

                        // ダイス組み合わせ表示ロジック
                        if (isMyTurn && diceRolled && !isBusted) {
                            if (!combinationChosen) { // まだ組み合わせを選んでいない
                                if (diceCombinationChoiceArea) {
                                    diceCombinationChoiceArea.innerHTML = ''; // クリア
                                    generateDiceCombinations(roomData.turnDiceRoll);
                                    diceCombinationChoiceArea.classList.remove('hidden');
                                }
                            } else { // 組み合わせ選択済み
                                if (diceCombinationChoiceArea) {
                                    // 表示はそのままに、操作を不可にする
                                    diceCombinationChoiceArea.querySelectorAll('input, button').forEach(el => el.disabled = true);
                                    diceCombinationChoiceArea.classList.remove('hidden');
                                }
                            }
                        } else { // 自分のターンでない、またはダイスロール前、またはバストした
                            if (diceCombinationChoiceArea) diceCombinationChoiceArea.classList.add('hidden');
                        }

                        // バストした場合のUI処理 (メッセージ表示は既にある程度カバーされている)
                        if (isBusted && isMyTurn) { // 自分のターンでバストした
                           // ターンは selectDiceCombination で自動的に次に移るので、ここでは特別なボタン操作は不要
                           // メッセージ表示で十分
                           if (messageDisplay) messageDisplay.textContent = "バストしました！ターン終了です。";
                        }
                    }
                } else if (roomData.status === 'waiting') {
                    showRoomManagementUI();
                    if (gameInfoDiv) gameInfoDiv.classList.remove('hidden'); // 参加者リストなどのために表示
                    if (playerListAreaDiv) playerListAreaDiv.classList.remove('hidden');
                    if (gameBoardDiv) gameBoardDiv.classList.add('hidden');
                    if (diceAreaDiv) diceAreaDiv.classList.add('hidden');
                    if (actionAreaDiv) actionAreaDiv.classList.add('hidden');
                    if (messageDisplay) messageDisplay.textContent = "プレイヤーの参加を待っています...";

                    const amIHost = roomData.hostId === localPlayerId;
                    const numPlayers = Object.keys(roomData.players).length;
                    if (startGameButton) {
                        startGameButton.disabled = !(amIHost && numPlayers >= MIN_PLAYERS_TO_START && numPlayers <= MAX_PLAYERS);
                        if (amIHost) startGameButton.classList.remove('hidden');
                        else startGameButton.classList.add('hidden');
                    }
                } else if (roomData.status === 'waiting') {
                    // UIを待機状態に
                    showRoomManagementUI(); // 部屋管理UIに戻すか、専用の待機UIを作るか
                    // listenToRoomUpdates の中で再度 showGameRelatedUI が呼ばれるので、
                    // ここで roomManagementDiv を表示するとちらつく可能性がある。
                    // 代わりに、gameInfoDiv などに「待機中」のメッセージを出す。
                    if(gameInfoDiv) gameInfoDiv.classList.remove('hidden');
                    if(playerListAreaDiv) playerListAreaDiv.classList.remove('hidden'); // 参加者リストは表示
                    if(gameBoardDiv) gameBoardDiv.classList.add('hidden');
                    if(diceAreaDiv) diceAreaDiv.classList.add('hidden');
                    if(actionAreaDiv) actionAreaDiv.classList.add('hidden');


                    const amIHost = roomData.hostId === localPlayerId;
                    const numPlayers = Object.keys(roomData.players).length;
                    if (startGameButton) {
                        startGameButton.disabled = !(amIHost && numPlayers >= MIN_PLAYERS_TO_START && numPlayers <= MAX_PLAYERS);
                        if(amIHost) startGameButton.classList.remove('hidden');
                        else startGameButton.classList.add('hidden');
                    }
                } else if (roomData.status === 'finished') {
                    showGameRelatedUI(roomData.hostId === localPlayerId); // isHost
                    if (rollDiceButton) rollDiceButton.disabled = true;
                    if (stopButton) stopButton.disabled = true;
                    if (diceCombinationChoiceArea) diceCombinationChoiceArea.style.display = 'none';
                    if (startGameButton) startGameButton.classList.add('hidden');

                    const winner = players.find(p => p.id === roomData.winnerId);
                    if (winner) {
                        if (currentPlayerDisplay) currentPlayerDisplay.innerHTML = `勝者: <strong style="color:${winner.color};">${winner.name}</strong> さん！`;
                        if (messageDisplay) messageDisplay.textContent = "ゲーム終了！おめでとうございます！";
                        if (localPlayerId === roomData.winnerId || (!doc.metadata.hasPendingWrites && roomData.winnerId)) {
                            // 自分が勝者、または他の誰かが勝ってデータが確定した場合にアラート
                            setTimeout(() => alert(`ゲーム終了！ 勝者は ${winner.name} さんです！`), 100); // Give UI time to update
                        }
                    } else {
                        if (currentPlayerDisplay) currentPlayerDisplay.textContent = "ゲーム終了";
                        if (messageDisplay) messageDisplay.textContent = "ゲームが終了しました。";
                         if (!doc.metadata.hasPendingWrites) { // データ確定後
                            setTimeout(() => alert("ゲーム終了！"), 100);
                         }
                    }
                }
                previousActivePlayerId = roomData.activePlayerId;

            } else { // doc.exists === false or access denied
                console.warn("Room data no longer exists or access denied for room:", roomId);
                alert("部屋の情報が見つからないか、アクセスが拒否されました。ロビーに戻ります。");
                if (roomUnsubscribe) {
                    roomUnsubscribe();
                    roomUnsubscribe = null;
                }
                showRoomManagementUI(); // 初期UIに戻す
                currentRoomId = null;
                localPlayerId = null;
                players = [];
                activePlayerId = null;
                claimedTracks = {};
                tempMarkersOnBoard = [];
                updatePlayersList();
                updateCurrentPlayerDisplay();
                updateBoardMarkers();
                updateDiceResultDisplay([]);
            }
        }, (error) => {
            console.error("Error listening to room updates: ", error);
        });
}
