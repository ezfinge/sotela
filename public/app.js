const socket = io();

// Elementos DOM
const serverModal = document.getElementById('serverModal');
const modalTitle = document.getElementById('modalTitle');
const serverNameInput = document.getElementById('serverNameInput');
const serverIdInput = document.getElementById('serverIdInput');
const confirmServerBtn = document.getElementById('confirmServerBtn');
const cancelServerBtn = document.getElementById('cancelServerBtn');
const createServerBtn = document.getElementById('createServerBtn');
const joinServerBtn = document.getElementById('joinServerBtn');
const sidebar = document.getElementById('sidebar');
const serverName = document.getElementById('serverName');
const serverLink = document.getElementById('serverLink');
const shareScreenBtn = document.getElementById('shareScreenBtn');
const stopShareBtn = document.getElementById('stopShareBtn');
const screensContainer = document.getElementById('screensContainer');
const statusIndicator = document.getElementById('statusIndicator');
const noContent = document.getElementById('noContent');
const inviteLinkInput = document.getElementById('inviteLinkInput');
const copyInviteBtn = document.getElementById('copyInviteBtn');
const copyIdBtn = document.getElementById('copyIdBtn');
const inviteId = document.getElementById('inviteId');
const hiddenScreensBox = document.getElementById('hiddenScreensBox');
const hiddenScreensList = document.getElementById('hiddenScreensList');

let currentServerId = null;
let localStream = null;
let isSharing = false;
let modalOpen = false;
let currentQuality = 'medium';
const peerConnections = new Map();
const remoteStreams = new Map();
const hiddenStreams = new Set();

const qualityOptions = {
    high: { label: 'Alta (1080p)', width: 1920, height: 1080, fps: 60 },
    medium: { label: 'Média (720p)', width: 1280, height: 720, fps: 30 },
    low: { label: 'Baixa (480p)', width: 854, height: 480, fps: 24 }
};

// ================= MODAL =================
function openModal(mode) {
    modalOpen = true;
    serverModal.classList.remove('hidden');
    serverModal.classList.add('active');
    serverModal.style.display = 'flex';
    
    if (mode === 'create') {
        modalTitle.textContent = 'Criar Servidor';
        serverNameInput.classList.remove('hidden');
        serverNameInput.style.display = 'block';
        serverIdInput.classList.add('hidden');
        serverIdInput.style.display = 'none';
        serverNameInput.focus();
    } else {
        modalTitle.textContent = 'Entrar em Servidor';
        serverNameInput.classList.add('hidden');
        serverNameInput.style.display = 'none';
        serverIdInput.classList.remove('hidden');
        serverIdInput.style.display = 'block';
        serverIdInput.focus();
    }
}

function closeModal() {
    modalOpen = false;
    serverModal.classList.add('hidden');
    serverModal.classList.remove('active');
    serverModal.style.display = 'none';
}

function updateInviteLink(serverId) {
    console.log('🔗 Gerando link de convite para servidor:', serverId);
    
    const baseUrl = window.location.origin;
    const inviteUrl = `${baseUrl}/?server=${serverId}`;
    
    console.log('📋 Link gerado:', inviteUrl);
    
    // Atualizar o input
    inviteLinkInput.value = inviteUrl;
    inviteId.textContent = serverId;
    
    // Tornar o input visível
    inviteLinkInput.style.display = 'block';
    
    // Selecionar automaticamente para facilitar cópia
    inviteLinkInput.select();
}

// ================= QUALIDADE =================
function setQuality(quality) {
    currentQuality = quality;
    console.log('🎥 Qualidade alterada para:', quality);
    
    document.querySelectorAll('.quality-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    const activeBtn = document.querySelector(`[data-quality="${quality}"]`);
    if (activeBtn) activeBtn.classList.add('active');
}

function addQualityControls() {
    const existingControls = document.querySelector('.quality-controls');
    if (existingControls) existingControls.remove();
    
    const qualityContainer = document.createElement('div');
    qualityContainer.className = 'quality-controls';
    qualityContainer.innerHTML = '<span>Qualidade:</span>';
    
    Object.keys(qualityOptions).forEach(quality => {
        const btn = document.createElement('button');
        btn.className = `quality-btn ${quality === currentQuality ? 'active' : ''}`;
        btn.textContent = qualityOptions[quality].label;
        btn.dataset.quality = quality;
        btn.addEventListener('click', () => setQuality(quality));
        qualityContainer.appendChild(btn);
    });
    
    const shareControls = document.querySelector('.main-content > div');
    if (shareControls) shareControls.appendChild(qualityContainer);
}

function setupServerUI() {
    addQualityControls();
}

// ================= TELA CHEIA =================
function toggleFullscreen(videoContainer) {
    if (!document.fullscreenElement) {
        if (videoContainer.requestFullscreen) {
            videoContainer.requestFullscreen();
        }
        videoContainer.classList.add('fullscreen-active');
    } else {
        if (document.exitFullscreen) {
            document.exitFullscreen();
        }
        videoContainer.classList.remove('fullscreen-active');
    }
}

document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement) {
        document.querySelectorAll('.fullscreen-active').forEach(el => {
            el.classList.remove('fullscreen-active');
        });
    }
});

// ================= EVENTOS =================
createServerBtn.addEventListener('click', () => openModal('create'));
joinServerBtn.addEventListener('click', () => openModal('join'));
cancelServerBtn.addEventListener('click', closeModal);

confirmServerBtn.addEventListener('click', () => {
    if (modalTitle.textContent === 'Criar Servidor') {
        const name = serverNameInput.value.trim() || 'Meu Servidor';
        closeModal();
        socket.emit('create-server', name);
    } else {
        const serverId = serverIdInput.value.trim();
        if (serverId) {
            closeModal();
            socket.emit('join-server', serverId);
        } else {
            alert('Digite o ID do servidor');
        }
    }
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modalOpen) closeModal();
});

serverModal.addEventListener('click', (e) => {
    if (e.target === serverModal) closeModal();
});

serverNameInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') confirmServerBtn.click();
});

serverIdInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') confirmServerBtn.click();
});

copyInviteBtn.addEventListener('click', () => {
    inviteLinkInput.select();
    document.execCommand('copy');
    alert('✅ Link copiado!');
});

copyIdBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(currentServerId);
    alert('✅ ID copiado!');
});

// ================= SOCKET EVENTS =================
socket.on('connect', () => {
    console.log('✅ Conectado ao servidor');
});

socket.on('server-created', (data) => {
    console.log('🎉 Servidor criado:', data);
    currentServerId = data.serverId;
    sidebar.classList.remove('hidden');
    serverName.textContent = data.serverName;
    
    // Gerar link de convite
    updateInviteLink(data.serverId);
    
    shareScreenBtn.classList.remove('hidden');
    noContent.classList.add('hidden');
    setupServerUI();
    
    // Mostrar alerta com o link
    const inviteUrl = `${window.location.origin}/?server=${data.serverId}`;
    alert(`✅ Servidor criado!\n\n🔗 Link de convite:\n${inviteUrl}\n\nCompartilhe este link com seus amigos!`);
});

socket.on('server-info', (data) => {
    console.log('📋 Informações do servidor:', data);
    currentServerId = data.id;
    sidebar.classList.remove('hidden');
    serverName.textContent = data.name;
    
    // Gerar link de convite
    updateInviteLink(data.id);
    
    shareScreenBtn.classList.remove('hidden');
    noContent.classList.add('hidden');
    setupServerUI();
});

// ============ EVENTOS DE STREAM ============
socket.on('user-joined', (data) => {
    console.log('👤 Usuário entrou:', data.userId);
    
    // Se EU estou transmitindo, criar conexão com o novo usuário
    if (isSharing && data.userId !== socket.id) {
        console.log('📡 Criando conexão com novo usuário:', data.userId);
        createPeerConnection(data.userId, true);
    }
});

socket.on('existing-streamers', (streamers) => {
    console.log('📡 Transmissores existentes:', streamers);
    
    // Criar conexões com quem já está transmitindo
    streamers.forEach(userId => {
        if (userId !== socket.id) {
            console.log('🔗 Criando conexão com transmissor:', userId);
            createPeerConnection(userId, false);
        }
    });
});

socket.on('stream-started', (data) => {
    console.log('📡 Transmissão iniciada por:', data.userId);
    
    // Alguém começou a transmitir, criar conexão
    if (data.userId !== socket.id) {
        console.log('🔗 Criando conexão para receber transmissão de:', data.userId);
        createPeerConnection(data.userId, false);
    }
});

socket.on('stream-stopped', (data) => {
    console.log('🛑 Transmissão parada por:', data.userId);
    removeRemoteVideo(data.userId);
    if (peerConnections.has(data.userId)) {
        peerConnections.get(data.userId).close();
        peerConnections.delete(data.userId);
    }
});

socket.on('offer', async (data) => {
    console.log('📥 Recebida oferta de:', data.from);
    
    createPeerConnection(data.from, false);
    const pc = peerConnections.get(data.from);
    
    try {
        await pc.setRemoteDescription(data.offer);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        
        socket.emit('answer', {
            answer: pc.localDescription,
            to: data.from
        });
    } catch (err) {
        console.error('❌ Erro ao processar oferta:', err);
    }
});

socket.on('answer', async (data) => {
    console.log('📥 Recebida resposta de:', data.from);
    
    const pc = peerConnections.get(data.from);
    if (pc) {
        try {
            await pc.setRemoteDescription(data.answer);
            console.log('✅ Conexão estabelecida com:', data.from);
        } catch (err) {
            console.error('❌ Erro ao processar resposta:', err);
        }
    }
});

socket.on('ice-candidate', async (data) => {
    const pc = peerConnections.get(data.from);
    if (pc) {
        try {
            await pc.addIceCandidate(data.candidate);
        } catch (err) {
            console.error('❌ Erro ao adicionar ICE:', err);
        }
    }
});

socket.on('user-left', (userId) => {
    console.log('👋 Usuário saiu:', userId);
    removeRemoteVideo(userId);
    if (peerConnections.has(userId)) {
        peerConnections.get(userId).close();
        peerConnections.delete(userId);
    }
});

socket.on('error', (error) => {
    console.error('⚠️ Erro:', error);
    alert('Erro: ' + error);
});

// ================= WEBRTC =================
const configuration = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        {
            urls: 'turn:openrelay.metered.ca:80',
            username: 'openrelayproject',
            credential: 'openrelayproject'
        }
    ]
};

function createPeerConnection(userId, isInitiator) {
    console.log('🔗 Criando peer connection com:', userId, 'Iniciador:', isInitiator);
    
    if (peerConnections.has(userId)) {
        console.log('⚠️ Conexão já existe com:', userId);
        return peerConnections.get(userId);
    }
    
    const pc = new RTCPeerConnection(configuration);
    peerConnections.set(userId, pc);
    
    // Adicionar tracks locais se estiver compartilhando
    if (localStream) {
        localStream.getTracks().forEach(track => {
            pc.addTrack(track, localStream);
            console.log('➕ Track adicionada:', track.kind);
        });
    }
    
    // Receber stream remoto
    pc.ontrack = (event) => {
        console.log('📺 Recebendo stream de:', userId);
        
        if (event.streams.length > 0) {
            const stream = event.streams[0];
            if (!hiddenStreams.has(userId)) {
                addRemoteVideo(userId, stream);
            }
        }
    };
    
    pc.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('ice-candidate', {
                candidate: event.candidate,
                to: userId
            });
        }
    };
    
    pc.onconnectionstatechange = () => {
        console.log('🔄 Estado da conexão com', userId, ':', pc.connectionState);
    };
    
    // Se for iniciador (quem está transmitindo), criar oferta
    if (isInitiator) {
        pc.createOffer()
            .then(offer => pc.setLocalDescription(offer))
            .then(() => {
                socket.emit('offer', {
                    offer: pc.localDescription,
                    to: userId
                });
                console.log('📤 Oferta enviada para:', userId);
            })
            .catch(err => console.error('❌ Erro ao criar oferta:', err));
    }
    
    return pc;
}

async function startScreenShare() {
    try {
        const quality = qualityOptions[currentQuality];
        
        localStream = await navigator.mediaDevices.getDisplayMedia({
            video: {
                cursor: "always",
                width: { ideal: quality.width },
                height: { ideal: quality.height },
                frameRate: { ideal: quality.fps }
            },
            audio: true
        });
        
        isSharing = true;
        shareScreenBtn.classList.add('hidden');
        stopShareBtn.classList.remove('hidden');
        statusIndicator.textContent = '🟢 AO VIVO';
        statusIndicator.classList.remove('hidden');
        statusIndicator.classList.add('live');
        
        addLocalVideo(localStream);
        
        // Notificar servidor
        if (currentServerId) {
            socket.emit('start-stream');
            console.log('📡 Transmissão iniciada, notificando servidor');
        }
        
        localStream.getTracks().forEach(track => {
            track.onended = () => stopScreenShare();
        });
    } catch (error) {
        console.error('❌ Erro ao compartilhar tela:', error);
        alert('Erro ao compartilhar tela: ' + error.message);
    }
}

function stopScreenShare() {
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
    
    isSharing = false;
    shareScreenBtn.classList.remove('hidden');
    stopShareBtn.classList.add('hidden');
    statusIndicator.textContent = '🔴 NÃO ESTÁ TRANSMITINDO';
    statusIndicator.classList.remove('live');
    
    removeLocalVideo();
    
    peerConnections.forEach(pc => pc.close());
    peerConnections.clear();
    
    if (currentServerId) {
        socket.emit('stop-stream');
    }
}

function addLocalVideo(stream) {
    removeLocalVideo();
    
    const videoContainer = document.createElement('div');
    videoContainer.className = 'screen-item';
    videoContainer.id = 'local-video-container';
    
    const video = document.createElement('video');
    video.autoplay = true;
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    
    const label = document.createElement('div');
    label.className = 'screen-label';
    label.textContent = '🖥️ Sua tela';
    
    const controls = document.createElement('div');
    controls.className = 'video-controls';
    
    const fullscreenBtn = document.createElement('button');
    fullscreenBtn.className = 'control-btn';
    fullscreenBtn.textContent = '⛶ Tela Cheia';
    fullscreenBtn.addEventListener('click', () => toggleFullscreen(videoContainer));
    
    controls.appendChild(fullscreenBtn);
    
    videoContainer.appendChild(video);
    videoContainer.appendChild(label);
    videoContainer.appendChild(controls);
    screensContainer.appendChild(videoContainer);
}

function removeLocalVideo() {
    const localVideoContainer = document.getElementById('local-video-container');
    if (localVideoContainer) localVideoContainer.remove();
}

function addRemoteVideo(userId, stream) {
    console.log('➕ Adicionando vídeo remoto de:', userId);
    
    const existingVideo = document.getElementById(`remote-video-${userId}`);
    if (existingVideo) return;
    
    const videoContainer = document.createElement('div');
    videoContainer.className = 'screen-item';
    videoContainer.id = `remote-video-${userId}`;
    
    const video = document.createElement('video');
    video.autoplay = true;
    video.playsInline = true;
    video.srcObject = stream;
    
    const label = document.createElement('div');
    label.className = 'screen-label';
    label.textContent = `🖥️ Tela de ${userId.slice(0, 8)}`;
    
    const controls = document.createElement('div');
    controls.className = 'video-controls';
    
    const fullscreenBtn = document.createElement('button');
    fullscreenBtn.className = 'control-btn';
    fullscreenBtn.textContent = '⛶ Tela Cheia';
    fullscreenBtn.addEventListener('click', () => toggleFullscreen(videoContainer));
    
    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'control-btn stop-view';
    toggleBtn.textContent = '🚫 Parar de Ver';
    toggleBtn.addEventListener('click', () => toggleScreen(userId));
    
    controls.appendChild(fullscreenBtn);
    controls.appendChild(toggleBtn);
    
    videoContainer.appendChild(video);
    videoContainer.appendChild(label);
    videoContainer.appendChild(controls);
    screensContainer.appendChild(videoContainer);
    
    remoteStreams.set(userId, { stream, videoContainer, video });
    console.log('✅ Vídeo remoto adicionado à página');
}

function toggleScreen(userId) {
    const streamData = remoteStreams.get(userId);
    if (!streamData) return;
    
    if (!hiddenStreams.has(userId)) {
        hiddenStreams.add(userId);
        streamData.videoContainer.style.display = 'none';
        addToHiddenList(userId);
    } else {
        hiddenStreams.delete(userId);
        streamData.videoContainer.style.display = 'block';
        streamData.video.srcObject = streamData.stream;
        removeFromHiddenList(userId);
    }
}

function addToHiddenList(userId) {
    hiddenScreensBox.classList.remove('hidden');
    
    const li = document.createElement('li');
    li.className = 'hidden-screen-item';
    li.id = `hidden-item-${userId}`;
    li.innerHTML = `
        <span>Tela de ${userId.slice(0, 8)}</span>
        <button onclick="showHiddenScreen('${userId}')">👁️ Ver</button>
    `;
    hiddenScreensList.appendChild(li);
}

function removeFromHiddenList(userId) {
    const hiddenItem = document.getElementById(`hidden-item-${userId}`);
    if (hiddenItem) hiddenItem.remove();
    
    if (hiddenScreensList.children.length === 0) {
        hiddenScreensBox.classList.add('hidden');
    }
}

function showHiddenScreen(userId) {
    const streamData = remoteStreams.get(userId);
    if (!streamData) return;
    
    hiddenStreams.delete(userId);
    streamData.videoContainer.style.display = 'block';
    streamData.video.srcObject = streamData.stream;
    removeFromHiddenList(userId);
}

window.showHiddenScreen = showHiddenScreen;

function removeRemoteVideo(userId) {
    const videoContainer = document.getElementById(`remote-video-${userId}`);
    if (videoContainer) videoContainer.remove();
    remoteStreams.delete(userId);
    hiddenStreams.delete(userId);
    removeFromHiddenList(userId);
}

// ================= EVENT LISTENERS =================
shareScreenBtn.addEventListener('click', startScreenShare);
stopShareBtn.addEventListener('click', stopScreenShare);

// ================= AUTO-ENTRAR VIA LINK =================
window.addEventListener('load', () => {
    const urlParams = new URLSearchParams(window.location.search);
    const serverId = urlParams.get('server');
    if (serverId) {
        socket.emit('join-server', serverId);
    }
});

window.addEventListener('beforeunload', () => {
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
    }
    peerConnections.forEach(pc => pc.close());
});

console.log('🚀 App carregado com sucesso!');
