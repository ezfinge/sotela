const socket = io();

let currentServerId = null;
let currentChannelId = null;
let localStream = null;
let isSharing = false;
const peerConnections = new Map();
const remoteStreams = new Map();

// DOM Elements
const sidebar = document.getElementById('sidebar');
const mainContent = document.getElementById('mainContent');
const screensContainer = document.getElementById('screensContainer');
const channelList = document.getElementById('channelList');
const serverName = document.getElementById('serverName');
const serverLink = document.getElementById('serverLink');
const createServerBtn = document.getElementById('createServerBtn');
const joinServerBtn = document.getElementById('joinServerBtn');
const createChannelBtn = document.getElementById('createChannelBtn');
const shareScreenBtn = document.getElementById('shareScreenBtn');
const stopShareBtn = document.getElementById('stopShareBtn');
const statusIndicator = document.getElementById('statusIndicator');
const noContent = document.getElementById('noContent');
const serverModal = document.getElementById('serverModal');
const modalTitle = document.getElementById('modalTitle');
const serverNameInput = document.getElementById('serverNameInput');
const serverIdInput = document.getElementById('serverIdInput');
const confirmServerBtn = document.getElementById('confirmServerBtn');
const cancelServerBtn = document.getElementById('cancelServerBtn');

// Modal functions
function showModal(mode) {
    serverModal.classList.remove('hidden');
    serverNameInput.value = '';
    serverIdInput.value = '';
    
    if (mode === 'create') {
        modalTitle.textContent = 'Criar Servidor';
        serverNameInput.classList.remove('hidden');
        serverIdInput.classList.add('hidden');
    } else {
        modalTitle.textContent = 'Entrar em Servidor';
        serverNameInput.classList.add('hidden');
        serverIdInput.classList.remove('hidden');
    }
}

function hideModal() {
    serverModal.classList.add('hidden');
}

// Event Listeners
createServerBtn.addEventListener('click', () => showModal('create'));
joinServerBtn.addEventListener('click', () => showModal('join'));
cancelServerBtn.addEventListener('click', hideModal);

confirmServerBtn.addEventListener('click', () => {
    if (modalTitle.textContent === 'Criar Servidor') {
        const name = serverNameInput.value || 'Meu Servidor';
        socket.emit('create-server', name);
    } else {
        const serverId = serverIdInput.value;
        if (serverId) {
            socket.emit('join-server', serverId);
        }
    }
    hideModal();
});

createChannelBtn.addEventListener('click', () => {
    if (currentServerId) {
        const channelName = prompt('Nome do canal:');
        if (channelName) {
            socket.emit('create-channel', { serverId: currentServerId, channelName });
        }
    }
});

// Socket Event Handlers
socket.on('server-created', (data) => {
    currentServerId = data.serverId;
    socket.emit('join-server', data.serverId);
    updateServerLink();
});

socket.on('server-info', (data) => {
    currentServerId = data.id;
    serverName.textContent = data.name;
    updateServerLink();
    sidebar.classList.remove('hidden');
    noContent.classList.add('hidden');
    
    // Limpar lista de canais
    channelList.innerHTML = '';
    data.channels.forEach(channel => {
        addChannelToList(channel);
    });
    
    // Entrar automaticamente no primeiro canal
    if (data.channels.length > 0) {
        joinChannel(data.channels[0]);
    }
});

socket.on('channel-created', (channel) => {
    addChannelToList(channel);
});

socket.on('user-joined', (data) => {
    if (isSharing) {
        createPeerConnection(data.userId);
        const pc = peerConnections.get(data.userId);
        pc.createOffer()
            .then(offer => {
                return pc.setLocalDescription(offer);
            })
            .then(() => {
                socket.emit('offer', {
                    offer: pc.localDescription,
                    channelId: currentChannelId,
                    to: data.userId
                });
            });
    }
});

socket.on('user-list', (userList) => {
    console.log('Usuários no canal:', userList.length);
});

socket.on('existing-streamers', (streamers) => {
    streamers.forEach(streamerId => {
        if (streamerId !== socket.id) {
            createPeerConnection(streamerId);
        }
    });
});

socket.on('offer', async (data) => {
    if (!isSharing && localStream) {
        createPeerConnection(data.from);
        const pc = peerConnections.get(data.from);
        await pc.setRemoteDescription(data.offer);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit('answer', {
            answer: pc.localDescription,
            to: data.from
        });
    }
});

socket.on('answer', async (data) => {
    const pc = peerConnections.get(data.from);
    if (pc) {
        await pc.setRemoteDescription(data.answer);
    }
});

socket.on('ice-candidate', async (data) => {
    const pc = peerConnections.get(data.from);
    if (pc) {
        await pc.addIceCandidate(data.candidate);
    }
});

socket.on('user-left', (userId) => {
    if (peerConnections.has(userId)) {
        peerConnections.get(userId).close();
        peerConnections.delete(userId);
    }
    removeRemoteVideo(userId);
});

// WebRTC Functions
const configuration = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ]
};

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
        statusIndicator.textContent = 'AO VIVO';
        statusIndicator.classList.remove('hidden');
        statusIndicator.classList.add('live');
        
        // Adicionar vídeo local
        addLocalVideo(localStream);
        
        // Criar peer connections para todos no canal
        socket.emit('start-stream', { channelId: currentChannelId });
        
        localStream.getTracks().forEach(track => {
            track.onended = () => {
                stopScreenShare();
            };
        });
    } catch (error) {
        console.error('Erro ao compartilhar tela:', error);
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
    statusIndicator.textContent = 'NÃO ESTÁ TRANSMITINDO';
    statusIndicator.classList.remove('live');
    
    removeLocalVideo();
    
    // Fechar todas as peer connections
    peerConnections.forEach((pc, userId) => {
        pc.close();
    });
    peerConnections.clear();
    
    socket.emit('stop-stream', { channelId: currentChannelId });
}

function createPeerConnection(userId) {
    if (peerConnections.has(userId)) {
        return peerConnections.get(userId);
    }
    
    const pc = new RTCPeerConnection(configuration);
    peerConnections.set(userId, pc);
    
    // Adicionar tracks locais
    if (localStream) {
        localStream.getTracks().forEach(track => {
            pc.addTrack(track, localStream);
        });
    }
    
    // Receber stream remoto
    pc.ontrack = (event) => {
        addRemoteVideo(userId, event.streams[0]);
    };
    
    pc.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('ice-candidate', {
                candidate: event.candidate,
                to: userId
            });
        }
    };
    
    return pc;
}

function joinChannel(channel) {
    currentChannelId = channel.id;
    socket.emit('join-channel', { channelId: channel.id });
    
    // Atualizar UI
    document.querySelectorAll('.channel-item').forEach(item => {
        item.classList.remove('active');
    });
    
    const channelElement = document.querySelector(`[data-channel-id="${channel.id}"]`);
    if (channelElement) {
        channelElement.classList.add('active');
    }
    
    // Mostrar botão de compartilhamento
    shareScreenBtn.classList.remove('hidden');
    noContent.classList.add('hidden');
}

function addChannelToList(channel) {
    const li = document.createElement('li');
    li.className = 'channel-item';
    li.textContent = `# ${channel.name}`;
    li.dataset.channelId = channel.id;
    li.addEventListener('click', () => joinChannel(channel));
    channelList.appendChild(li);
}

function updateServerLink() {
    serverLink.textContent = `ID do servidor: ${currentServerId}`;
    serverLink.title = 'Clique para copiar';
    serverLink.addEventListener('click', () => {
        navigator.clipboard.writeText(currentServerId);
        alert('ID do servidor copiado!');
    });
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
    video.srcObject = stream;
    
    const label = document.createElement('div');
    label.className = 'screen-label';
    label.textContent = 'Sua tela';
    
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
    removeRemoteVideo(userId);
    
    const videoContainer = document.createElement('div');
    videoContainer.className = 'screen-item';
    videoContainer.id = `remote-video-${userId}`;
    
    const video = document.createElement('video');
    video.autoplay = true;
    video.srcObject = stream;
    
    const label = document.createElement('div');
    label.className = 'screen-label';
    label.textContent = `Tela de ${userId.slice(0, 8)}`;
    
    videoContainer.appendChild(video);
    videoContainer.appendChild(label);
    screensContainer.appendChild(videoContainer);
    
    remoteStreams.set(userId, stream);
}

function removeRemoteVideo(userId) {
    const videoContainer = document.getElementById(`remote-video-${userId}`);
    if (videoContainer) {
        videoContainer.remove();
    }
    remoteStreams.delete(userId);
}

// Event Listeners para compartilhamento
shareScreenBtn.addEventListener('click', startScreenShare);
stopShareBtn.addEventListener('click', stopScreenShare);

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
    }
    peerConnections.forEach(pc => pc.close());
});