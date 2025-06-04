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
// Room Management Elements
const roomManagementDiv = document.getElementById('room-management');
const hostNameInput = document.getElementById('host-name');         // 部屋作成時のホスト名入力フィールド
const createRoomButton = document.getElementById('create-room-btn');    // 部屋作成ボタン
const roomIdDisplay = document.getElementById('room-id-display');       // 作成/参加した部屋IDの表示エリア
const clientNameInput = document.getElementById('client-name');       // 部屋参加時のクライアント名入力フィールド
const roomIdInput = document.getElementById('room-id-input');         // 参加する部屋IDの入力フィールド
const joinRoomButton = document.getElementById('join-room-btn');      // 部屋参加ボタン

// Game Information Elements
const gameInfoDiv = document.getElementById('game-info');             // ゲーム情報セクションのコンテナ
const currentPlayerDisplay = document.getElementById('current-player-display'); // 現在のターンプレイヤー名表示エリア
const messageDisplay = document.getElementById('message-display');       // ゲームメッセージ表示エリア
const startGameButton = document.getElementById('start-game-btn');      // ゲーム開始ボタン

// Player List Area
const playerListAreaDiv = document.getElementById('player-list-area');  // 参加者リストセクションのコンテナ
const playerListUl = document.getElementById('player-list');            // 参加者リスト(ul要素)

// Game Play Area Elements
const gamePlayAreaDiv = document.getElementById('game-play-area');    // ゲーム盤・ダイス・アクションエリアの親コンテナ
const gameBoardDiv = document.getElementById('game-board');           // ゲームボード本体描画エリア

// Dice Area Elements
const diceAreaDiv = document.getElementById('dice-area');             // ダイス関連UIのコンテナ
const diceResultDisplay = document.getElementById('dice-result-display'); // ダイスロール結果表示エリア
const rollDiceButton = document.getElementById('roll-dice-btn');        // ダイスを振る/続けるボタン

// Action Area Elements
const actionAreaDiv = document.getElementById('action-area');           // アクション関連UIのコンテナ
const diceCombinationChoiceArea = document.getElementById('dice-combination-choice-area'); // ダイス組み合わせ選択肢表示エリア
const stopButton = document.getElementById('stop-btn');                 // ストップボタン


// --- Game Configuration Constants ---
const MAX_PLAYERS = 4;          // 部屋の最大プレイヤー数
const MIN_PLAYERS_TO_START = 2; // ゲーム開始に必要な最低プレイヤー数
const TRACK_CONFIG = {          // 各トラックのマス数 (キー:トラック番号(文字列), 値:マス数(数値))
    '2': 3, '3': 5, '4': 7, '5': 9, '6': 11, '7': 13,
    '8': 11, '9': 9, '10': 7, '11': 5, '12': 3
};
const PLAYER_COLORS = ['red', 'blue', 'green', 'yellow']; // プレイヤーごとのデフォルトカラーパレット

// --- Global Game State Variables (Local cache, synced with Firestore) ---
let currentRoomId = null;       // 現在参加している部屋のID
let localPlayerId = null;       // このクライアントのプレイヤーID (部屋参加時に生成)
let players = [];               // 現在の部屋のプレイヤー情報オブジェクトの配列 (Firestoreから同期、参加順ソート済み)
let activePlayerId = null;      // 現在のターンプレイヤーのID (Firestoreから同期)
let tempMarkersOnBoard = {};    // 現在のターンプレイヤーの一時マーカー { trackNumberString: positionInt } (Firestoreから同期)
let claimedTracks = {};         // 占領されたトラック情報 { trackNumberString: playerIdString } (Firestoreから同期)

// --- UI Control / State Variables ---
let previousActivePlayerId = null; // 直前のターンプレイヤーID (主にバストメッセージ表示で使用)

// --- Function Definitions ---

/**
 * ゲームボードのHTML構造を動的に生成し、#game-board要素内に描画します。
 * この関数は、ゲームの初期化時または必要に応じて呼び出され、
 * TRACK_CONFIGに基づいてトラック、マス、ラベル、マーカーコンテナを生成します。
 */
function drawGameBoard() {
    if (!gameBoardDiv) {
        console.error("Game board element (#game-board) not found!");
        return;
    }
    gameBoardDiv.innerHTML = ''; // 描画前に既存のボード内容をクリア

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

                if (i === 1) { // 各トラックの最初のマス
                    cellDiv.classList.add('cant-stop-space');
                }
                if (i === numCells) { // 各トラックの最後のマス (ゴールライン)
                    cellDiv.classList.add('goal-line');
                }

                const markerContainer = document.createElement('div');
                markerContainer.classList.add('marker-container'); // マーカーを配置するための内部コンテナ
                cellDiv.appendChild(markerContainer);
                trackDiv.appendChild(cellDiv);
            }
            gameBoardDiv.appendChild(trackDiv);
        }
    }
    // console.log("Game board drawn."); // 初期化確認用ログ
}

/**
 * 新しいゲーム部屋を作成し、Firestoreに初期データを保存します。
 * ホストプレイヤーとして部屋に参加し、UIをゲーム待機状態に更新後、部屋情報の監視を開始します。
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
    currentPlayerName = hostName; // グローバル変数にも設定 (ただし、これはローカルでのみ使用)

    const playerObject = {
        id: localPlayerId,
        name: hostName,
        color: PLAYER_COLORS[0],
        joinOrder: 1,
        isHost: true,
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
 * 既存のゲーム部屋に参加し、Firestoreの部屋情報を更新します。
 * UIをゲーム待機状態に更新し、部屋情報のリアルタイム監視を開始します。
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
        currentPlayerName = clientName;
        const playerObject = {
            id: localPlayerId,
            name: clientName,
            color: PLAYER_COLORS[numPlayers % PLAYER_COLORS.length],
            joinOrder: numPlayers + 1,
            isHost: false,
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
 * ゲームを開始します (ホストプレイヤーのみ実行可能)。
 * Firestoreの部屋ステータスを 'playing' に変更し、最初のターンのプレイヤーを設定します。
 * ゲーム開始に必要な各種フィールドも初期化します。
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
        // 参加順 (joinOrder) が最も小さいプレイヤーを最初のターンプレイヤーとする
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
        // メッセージ更新はonSnapshotに任せる
    } catch (error) {
        console.error("Error starting game: ", error);
        setDisplayMessage("ゲーム開始エラー: " + error.message, "error");
    }
}

/**
 * プレイヤーリストのUIを更新します。
 * プレイヤー名、色インジケータ、占領列数、自分の名前と現在のターンプレイヤーを強調表示します。
 * @param {object|null} roomData - Firestoreから取得した現在の部屋データ。nullの場合はリストをクリアしデフォルトメッセージ表示。
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
 * 現在のターンプレイヤー名をUI (`currentPlayerDisplay`) に表示します。
 * 自分のターンの場合は強調し、ゲーム終了時は勝者情報を表示します。
 * @param {object|null} roomData - Firestoreから取得した現在の部屋データ。nullの場合は表示をクリア。
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
 * ダイスロール結果をUI (`diceResultDisplay`) に表示します。
 * @param {number[]} diceRolls - ダイスの目の配列 (例: [1, 2, 3, 4])。空配列やnullの場合はデフォルト表示。
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
 * ダイスを振る処理、または「続ける」場合のダイス情報リセットと再ロールを行います。
 * Firestoreの部屋データを更新し、結果を全プレイヤーに同期します。
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
        // 「続ける」条件: ダイスロール済み、組み合わせ選択済み、バストしてない、一時マーカーあり
        if (roomData.turnDiceRoll && roomData.turnDiceRoll.length > 0 &&
            roomData.turnChosenSums && roomData.turnChosenSums.length > 0 &&
            Object.keys(roomData.turnTemporaryMarkers || {}).length > 0 &&
            !roomData.turnBusted) {
            updates.turnDiceRoll = [];
            updates.turnChosenSums = [];
            updates.turnBusted = false;
            // turnTemporaryMarkers は現在の状態を維持
             console.log("Continuing turn: Resetting dice and chosen sums for re-roll.");
        } else if (roomData.turnDiceRoll && roomData.turnDiceRoll.length > 0) {
             // ダイスは振ったが、まだ「続ける」条件を満たしていない（組み合わせ未選択など）
             setDisplayMessage("既にダイスは振られています。組み合わせを選択するかストップしてください。", "info");
             return;
        }
        // それ以外（turnDiceRollが空）は最初のロールとして扱う

        const newDiceResults = [];
        for (let i = 0; i < 4; i++) {
            newDiceResults.push(Math.floor(Math.random() * 6) + 1);
        }
        updates.turnDiceRoll = newDiceResults;
        if (!updates.turnChosenSums) updates.turnChosenSums = [];
        if (updates.turnBusted === undefined) updates.turnBusted = false;

        await roomRef.update(updates);
        console.log("Dice rolled/reset. Firestore updates:", updates);
        // メッセージはonSnapshotで更新される

    } catch (error) {
        console.error("Error in rollDice: ", error);
        setDisplayMessage("ダイス処理エラー: " + error.message, "error");
    }
}

/**
 * 提示されたダイスの目から、可能なペアの組み合わせを生成し、UIに表示します。
 * 各組み合わせはラジオボタンとして表示され、選択すると対応するラベルに .selected クラスが付与されます。
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
    // console.log("Dice combinations generated and displayed:", uniqueSumPairs);
}

/**
 * プレイヤーが選択したダイスの組み合わせに基づき、一時マーカーを配置または進行させます。
 * 進行ルール（3マーカー制限、占領列不可など）を適用し、進行不可能な場合はバスト処理を行います。
 * 結果（更新された一時マーカー、バスト状態、次のターンプレイヤーなど）はFirestoreに保存されます。
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

        let currentTurnTempMarkers = JSON.parse(JSON.stringify(roomData.turnTemporaryMarkers || {}));
        const claimedCols = roomData.claimedColumns || {};
        let canAdvanceAnyMarker = false;
        let isBust = false;

        // 指定されたトラック(合計値)にマーカーを配置/進行可能かチェックする内部関数
        function canPlaceOrAdvanceOnTrack(trackSum) {
            if (trackSum < 2 || trackSum > 12) return false;
            if (claimedCols[trackSum] && claimedCols[trackSum] !== localPlayerId) return false;
            if (claimedCols[trackSum] && claimedCols[trackSum] === localPlayerId) return false;

            const currentMarkerPosition = currentTurnTempMarkers[String(trackSum)]; // Ensure string key
            if (currentMarkerPosition && currentMarkerPosition >= TRACK_CONFIG[String(trackSum)]) return false;

            const tempMarkerCount = Object.keys(currentTurnTempMarkers).length;
            if (!currentMarkerPosition && tempMarkerCount >= 3) return false;
            return true;
        }

        const uniqueChosenSumsToAttempt = chosenSums[0] === chosenSums[1] ? [chosenSums[0]] : chosenSums;

        for (const sum of uniqueChosenSumsToAttempt) {
            const sumStr = String(sum); // Use string for object keys
            if (canPlaceOrAdvanceOnTrack(sum)) {
                if (currentTurnTempMarkers[sumStr]) {
                    currentTurnTempMarkers[sumStr]++;
                } else {
                    currentTurnTempMarkers[sumStr] = 1;
                }
                canAdvanceAnyMarker = true;
            }
        }

        if (!canAdvanceAnyMarker) {
            isBust = true;
            console.log(`Player ${localPlayerId} busted. No valid moves for chosen sums: ${chosenSums.join(',')}`);
        }

        const updatesForFirestore = {
            turnChosenSums: chosenSums,
            turnTemporaryMarkers: isBust ? {} : currentTurnTempMarkers,
            turnBusted: isBust,
        };

        if (isBust) {
            updatesForFirestore.activePlayerId = getNextPlayerId(roomData);
            updatesForFirestore.turnDiceRoll = [];
            updatesForFirestore.turnChosenSums = [];
        }

        await roomRef.update(updatesForFirestore);
        // メッセージ表示はonSnapshotに任せる
        console.log("Dice combination processed and marker positions updated. Firestore updates:", updatesForFirestore);

    } catch (error) {
        console.error("Error in selectDiceCombination (advancing markers): ", error);
        setDisplayMessage("マーカー進行処理エラー: " + error.message, "error");
    }
}


/**
 * ボード上のマーカー表示を全体的に更新します。一時マーカーと占領マーカーの両方を描画します。
 * @param {object|null} roomData - Firestoreから取得した現在の部屋データ。nullの場合はマーカーをクリア。
 */
function updateBoardMarkers(roomData) {
    if (!gameBoardDiv) { console.error("gameBoardDiv not found in updateBoardMarkers"); return; }
    gameBoardDiv.querySelectorAll('.temp-marker, .claim-marker').forEach(m => m.remove());

    if (!roomData) {
        return;
    }

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

    // 現在のターンプレイヤーの一時マーカーを描画
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
                else console.warn("Marker container not found in cell:", cellToPlaceOn);
            }
        }
    }

    // 全プレイヤーの占領マーカーを描画
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
                else console.warn("Marker container not found in goal cell:", goalCell);
            }
        }
    }
}

/**
 * 「ストップ」アクションを処理します。
 * 現在の一時マーカーを確定し、必要なら列を占領します。
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
        // マーカーが一つも置かれていない、かつダイスも振っていない場合はストップできない
        if (Object.keys(roomData.turnTemporaryMarkers || {}).length === 0 &&
            (!roomData.turnDiceRoll || roomData.turnDiceRoll.length === 0)) {
            setDisplayMessage("まずダイスを振ってください。", "info"); return;
        }
        // ダイスは振ったが、組み合わせ選択やマーカー進行が終わっていない場合もストップさせない方が自然
        if (roomData.turnDiceRoll && roomData.turnDiceRoll.length > 0 &&
           (!(roomData.turnChosenSums && roomData.turnChosenSums.length > 0) || Object.keys(roomData.turnTemporaryMarkers || {}).length === 0) ) {
            setDisplayMessage("ダイスの組み合わせを選びマーカーを進めてください。", "info"); return;
        }


        let updatedClaimedColumns = { ...(roomData.claimedColumns || {}) };

        for (const colStr in roomData.turnTemporaryMarkers) {
            const position = roomData.turnTemporaryMarkers[colStr];
            const trackGoal = TRACK_CONFIG[colStr];
            if (position >= trackGoal && !updatedClaimedColumns[colStr]) {
                updatedClaimedColumns[colStr] = localPlayerId;
            }
        }

        let playerOccupiedCount = 0;
        if(roomData.players && roomData.players[localPlayerId]) {
             for (const col in updatedClaimedColumns) {
                if (updatedClaimedColumns[col] === localPlayerId) {
                    playerOccupiedCount++;
                }
            }
        } else {
            console.warn("Player data not found for occupied count calculation during stopTurn.");
        }

        const updates = {
            claimedColumns: updatedClaimedColumns,
            turnTemporaryMarkers: {},
            turnDiceRoll: [],
            turnChosenSums: [],
            turnBusted: false,
            activePlayerId: getNextPlayerId(roomData),
        };

        if (playerOccupiedCount >= 3) {
            updates.status = "finished";
            updates.winnerId = localPlayerId;
            console.log(`Player ${localPlayerId} wins with ${playerOccupiedCount} columns!`);
        }

        await roomRef.update(updates);
        console.log("Turn stopped. Firestore updated. Next player:", updates.activePlayerId);
        // メッセージ表示はonSnapshotが行う

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
        // プレイヤーが一人しかいない、または予期せぬ状況
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

// (コメントアウト) 不要になった、または他の関数に統合されたヘルパー関数群
// function continueTurn() { ... }  // rollDice にロジック統合
// function handleBust() { ... } // selectDiceCombination にロジック統合


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
        // console.log("Unsubscribing from previous room listener."); // デバッグ用
        roomUnsubscribe();
    }
    // console.log(`Listening to room ${roomId} for updates...`);

    // ターン変更検知のため、現在のactivePlayerIdを保持 (onSnapshotの直前に更新)
    previousActivePlayerId = activePlayerId;
    currentRoomId = roomId;


    roomUnsubscribe = db.collection('rooms').doc(roomId)
        .onSnapshot((doc) => {
            if (doc.exists) {
                const roomData = doc.data();
                // console.log("Room data snapshot: ", roomData);

                players = Object.values(roomData.players || {}).sort((a,b) => a.joinOrder - b.joinOrder);
                activePlayerId = roomData.activePlayerId;
                claimedTracks = roomData.claimedColumns || {};
                tempMarkersOnBoard = roomData.turnTemporaryMarkers || {};

                updatePlayersList(roomData);
                updateCurrentPlayerDisplay(roomData);
                updateBoardMarkers(roomData);
                updateDiceResultDisplay(roomData.turnDiceRoll);
                updateMessageDisplay(roomData);

                const isMyTurn = roomData.activePlayerId === localPlayerId;

                if (roomData.status === 'playing') {
                    showGameRelatedUI(roomData.hostId === localPlayerId, roomData.status);
                    if (startGameButton) startGameButton.classList.add('hidden');

                    const diceRolled = roomData.turnDiceRoll && roomData.turnDiceRoll.length > 0;
                    const combinationChosen = roomData.turnChosenSums && roomData.turnChosenSums.length > 0;
                    const isBusted = roomData.turnBusted;
                    const tempMarkersExist = Object.keys(roomData.turnTemporaryMarkers || {}).length > 0;

                    if (rollDiceButton) {
                        const canMakeFirstRoll = isMyTurn && !isBusted && !diceRolled;
                        const canContinue = isMyTurn && !isBusted && diceRolled && combinationChosen && tempMarkersExist;
                        rollDiceButton.disabled = !(canMakeFirstRoll || canContinue);
                        rollDiceButton.textContent = (diceRolled && combinationChosen && tempMarkersExist && !isBusted) ? '続ける' : 'ダイスを振る';
                    }

                    if (stopButton) {
                        stopButton.disabled = !(isMyTurn && !isBusted && diceRolled && tempMarkersExist);
                    }

                    if (diceCombinationChoiceArea) {
                        if (isMyTurn && diceRolled && !isBusted && !combinationChosen) {
                            diceCombinationChoiceArea.innerHTML = '';
                            generateDiceCombinations(roomData.turnDiceRoll);
                            diceCombinationChoiceArea.classList.remove('hidden');
                        } else if (isMyTurn && diceRolled && !isBusted && combinationChosen) {
                            diceCombinationChoiceArea.querySelectorAll('input, button').forEach(el => el.disabled = true);
                            diceCombinationChoiceArea.classList.remove('hidden');
                        } else {
                            diceCombinationChoiceArea.classList.add('hidden');
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
            // innerHTML を使用する場合は、内容が信頼できるソースからであることを確認。
            // ここではプレイヤー名なので、XSSのリスクは低いが注意。
            messageDisplay.innerHTML = `ゲーム終了！ <strong style="color:${winner.color || PLAYER_COLORS[PLAYER_COLORS.indexOf(winner.color)] || '#000'};">${winner.name}</strong> さんの勝利です！ 🎉`;
            setDisplayMessage(messageDisplay.textContent, 'success');
        } else {
            setDisplayMessage("ゲーム終了！", 'info');
        }
        return;
    }

    if (roomData.turnBusted) {
        // previousActivePlayerId は listenToRoomUpdates の onSnapshot の先頭で更新前の activePlayerId を参照して設定
        const bustedPlayer = roomData.players[previousActivePlayerId];
         if (bustedPlayer && previousActivePlayerId === localPlayerId) {
            setDisplayMessage("バスト！あなたのターンは終了しました。", "error");
         } else if (bustedPlayer) {
            setDisplayMessage(`${bustedPlayer.name}さんがバストしました。`, "error");
         } else {
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
    // previousActivePlayerId の更新は listenToRoomUpdates の onSnapshot のコールバック関数の **最初** で行う。
    // ここで previousActivePlayerId = roomData.activePlayerId とすると、
    // バストメッセージ表示時に「現在のターンプレイヤー (つまり次の人)」を参照してしまうため。
}
