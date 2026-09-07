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
const channelList = document.getElementById('channelList');
const createChannelBtn = document.getElementById('createChannelBtn');
const shareScreenBtn = document.getElementById('shareScreenBtn');
const stopShareBtn = document.getElementById('stopShareBtn');
const screensContainer = document.getElementById('screensContainer');
const statusIndicator = document.getElementById('statusIndicator');
const noContent = document.getElementById('noContent');
const inviteLinkInput = document.getElementById('inviteLinkInput');
const copyInviteBtn = document.getElementById('copyInviteBtn');
const copyIdBtn = document.getElementById('copyIdBtn');
const inviteId = document.getElementById('inviteId');

let currentServerId = null;
let currentChannelId = null;
let localStream = null;
let isSharing = false;
let modalOpen = false;
const peerConnections = new Map();
const remoteStreams = new Map();
const hiddenStreams = new Set(); // Streams que o usuário escolheu não ver

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
    const baseUrl = window.location.origin;
    const inviteUrl = `${baseUrl}/?server=${serverId}`;
    inviteLinkInput.value = inviteUrl;
    inviteId.textContent = serverId;
}

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
    currentServerId = data.serverId;
    sidebar.classList.remove('hidden');
    serverName.textContent = data.serverName;
    updateInviteLink(data.serverId);
    socket.emit('join-server', data.serverId);
});

socket.on('server-info', (data) => {
    currentServerId = data.id;
    sidebar.classList.remove('hidden');
    serverName.textContent = data.name;
    updateInviteLink(data.id);
    
    channelList.innerHTML = '';
    data.channels.forEach(channel => {
        addChannelToList(channel);
    });
    
    if (data.channels.length > 0) {
        joinChannel(data.channels[0]);
    }
});

socket.on('channel-created', (channel) => {
    addChannelToList(channel);
});

// ============ WEBRTC EVENTS ============
socket.on('user-joined', (data) => {
    console.log('👤 Usuário entrou:', data.userId);
    
    if (isSharing && data.userId !== socket.id) {
        console.log('📡 Criando conexão com novo usuário:', data.userId);
        createPeerConnection(data.userId, true);
    }
});

socket.on('existing-users', (users) => {
    console.log('👥 Usuários existentes:', users);
    
    users.forEach(userId => {
        if (userId !== socket.id) {
            console.log('🔗 Criando conexão com:', userId);
            createPeerConnection(userId, false);
        }
    });
});

socket.on('stream-started', (data) => {
    console.log('📡 Stream iniciado por:', data.userId);
    // O streamer vai criar a conexão
});

socket.on('stream-stopped', (data) => {
    console.log('🛑 Stream parado por:', data.userId);
    removeRemoteVideo(data.userId);
    if (peerConnections.has(data.userId)) {
        peerConnections.get(data.userId).close();
        peerConnections.delete(data.userId);
    }
    hiddenStreams.delete(data.userId);
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
        
        console.log('📤 Resposta enviada para:', data.from);
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
    hiddenStreams.delete(userId);
});

socket.on('error', (error) => {
    console.error('⚠️ Erro:', error);
    alert('Erro: ' + error);
});

// ================= CANAIS =================
function addChannelToList(channel) {
    const li = document.createElement('li');
    li.className = 'channel-item';
    li.textContent = `# ${channel.name}`;
    li.dataset.channelId = channel.id;
    li.addEventListener('click', () => joinChannel(channel));
    channelList.appendChild(li);
}

function joinChannel(channel) {
    currentChannelId = channel.id;
    socket.emit('join-channel', { channelId: channel.id });
    
    document.querySelectorAll('.channel-item').forEach(item => {
        item.classList.remove('active');
    });
    
    const channelElement = document.querySelector(`[data-channel-id="${channel.id}"]`);
    if (channelElement) {
        channelElement.classList.add('active');
    }
    
    shareScreenBtn.classList.remove('hidden');
    noContent.classList.add('hidden');
    
    console.log('🔗 Entrou no canal:', channel.name);
}

createChannelBtn.addEventListener('click', () => {
    if (currentServerId) {
        const channelName = prompt('Nome do canal:');
        if (channelName && channelName.trim()) {
            socket.emit('create-channel', { 
                serverId: currentServerId, 
                channelName: channelName.trim() 
            });
        }
    }
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
            
            // Se o stream não está na lista de ocultos, mostrar
            if (!hiddenStreams.has(userId)) {
                addRemoteVideo(userId, stream);
            } else {
                console.log('👁️ Stream oculto, não mostrando:', userId);
            }
        }
    };
    
    // ICE Candidate
    pc.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('ice-candidate', {
                candidate: event.candidate,
                to: userId
            });
        }
    };
    
    // Estado da conexão
    pc.onconnectionstatechange = () => {
        console.log('🔄 Estado da conexão com', userId, ':', pc.connectionState);
    };
    
    // Se for iniciador, criar oferta
    if (isInitiator) {
        pc.createOffer()
            .then(offer => {
                console.log('📤 Oferta criada para:', userId);
                return pc.setLocalDescription(offer);
            })
            .then(() => {
                socket.emit('offer', {
                    offer: pc.localDescription,
                    to: userId
                });
            })
            .catch(err => {
                console.error('❌ Erro ao criar oferta:', err);
            });
    }
    
    return pc;
}

async function startScreenShare() {
    try {
        localStream = await navigator.mediaDevices.getDisplayMedia({
            video: {
                cursor: "always"
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
        
        if (currentChannelId) {
            socket.emit('start-stream', { channelId: currentChannelId });
        }
        
        localStream.getTracks().forEach(track => {
            track.onended = () => {
                stopScreenShare();
            };
        });
        
        console.log('✅ Compartilhamento iniciado');
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
    
    peerConnections.forEach((pc) => {
        pc.close();
    });
    peerConnections.clear();
    
    if (currentChannelId) {
        socket.emit('stop-stream', { channelId: currentChannelId });
    }
}

function addLocalVideo(stream) {
    removeLocalVideo();
    
    const videoContainer = document.createElement('div');
    videoContainer.className = 'screen-item';
    videoContainer.id = 'local-video-container';
    
    const video = document.createElement('video');
    video.id = 'local-video';
    video.autoplay = true;
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    
    const label = document.createElement('div');
    label.className = 'screen-label';
    label.textContent = '🖥️ Sua tela';
    
    videoContainer.appendChild(video);
    videoContainer.appendChild(label);
    screensContainer.appendChild(videoContainer);
}

function removeLocalVideo() {
    const localVideoContainer = document.getElementById('local-video-container');
    if (localVideoContainer) {
        localVideoContainer.remove();
    }
}

function addRemoteVideo(userId, stream) {
    console.log('➕ Adicionando vídeo remoto de:', userId);
    
    // Verificar se já existe
    const existingVideo = document.getElementById(`remote-video-${userId}`);
    if (existingVideo) {
        return;
    }
    
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
    
    // Botão para ocultar/mostrar
    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'toggle-screen-btn';
    toggleBtn.textContent = '👁️ Ocultar';
    toggleBtn.dataset.userId = userId;
    toggleBtn.addEventListener('click', () => toggleScreen(userId));
    
    videoContainer.appendChild(video);
    videoContainer.appendChild(label);
    videoContainer.appendChild(toggleBtn);
    screensContainer.appendChild(videoContainer);
    
    remoteStreams.set(userId, { stream, videoContainer, video });
    console.log('✅ Vídeo remoto adicionado');
}

function removeRemoteVideo(userId) {
    const videoContainer = document.getElementById(`remote-video-${userId}`);
    if (videoContainer) {
        videoContainer.remove();
    }
    remoteStreams.delete(userId);
}

// ================= FUNÇÃO PARA ALTERNAR VISUALIZAÇÃO =================
function toggleScreen(userId) {
    const videoContainer = document.getElementById(`remote-video-${userId}`);
    if (!videoContainer) return;
    
    const video = videoContainer.querySelector('video');
    const toggleBtn = videoContainer.querySelector('.toggle-screen-btn');
    
    if (hiddenStreams.has(userId)) {
        // Mostrar novamente
        hiddenStreams.delete(userId);
        const streamData = remoteStreams.get(userId);
        if (streamData) {
            video.srcObject = streamData.stream;
            videoContainer.style.display = 'block';
            toggleBtn.textContent = '👁️ Ocultar';
            console.log('👁️ Mostrando tela de:', userId);
        }
    } else {
        // Ocultar
        hiddenStreams.add(userId);
        video.srcObject = null;
        videoContainer.style.display = 'none';
        toggleBtn.textContent = '👁️ Mostrar';
        console.log('🙈 Ocultando tela de:', userId);
    }
}

// ================= EVENT LISTENERS =================
shareScreenBtn.addEventListener('click', startScreenShare);
stopShareBtn.addEventListener('click', stopScreenShare);

// ================= AUTO-ENTRAR VIA LINK =================
window.addEventListener('load', () => {
    const urlParams = new URLSearchParams(window.location.search);
    const serverId = urlParams.get('server');
    if (serverId) {
        console.log('🔗 Entrando via link:', serverId);
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
console.log('📝 Sistema de visualização seletiva ativado');
