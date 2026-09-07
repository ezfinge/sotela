const socket = io({
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 1000
});

let currentServerId = null;
let currentChannelId = null;
let localStream = null;
let isSharing = false;
let isCreatingServer = false;
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
    console.log('Mostrando modal:', mode);
    serverModal.classList.remove('hidden');
    serverNameInput.value = '';
    serverIdInput.value = '';
    
    if (mode === 'create') {
        modalTitle.textContent = 'Criar Servidor';
        serverNameInput.classList.remove('hidden');
        serverIdInput.classList.add('hidden');
        serverNameInput.focus();
    } else {
        modalTitle.textContent = 'Entrar em Servidor';
        serverNameInput.classList.add('hidden');
        serverIdInput.classList.remove('hidden');
        serverIdInput.focus();
    }
}

function hideModal() {
    console.log('Fechando modal');
    serverModal.classList.add('hidden');
    serverNameInput.value = '';
    serverIdInput.value = '';
}

// Função para criar servidor
function createServer() {
    if (isCreatingServer) return;
    
    const name = serverNameInput.value.trim() || 'Meu Servidor';
    console.log('Criando servidor:', name);
    
    isCreatingServer = true;
    confirmServerBtn.disabled = true;
    confirmServerBtn.textContent = 'Criando...';
    
    // Emitir evento para criar servidor
    socket.emit('create-server', name);
    
    // Fechar modal imediatamente
    hideModal();
    
    // Resetar botão após um tempo
    setTimeout(() => {
        isCreatingServer = false;
        confirmServerBtn.disabled = false;
        confirmServerBtn.textContent = 'Confirmar';
    }, 1000);
}

// Função para entrar em servidor
function joinServer() {
    const serverId = serverIdInput.value.trim();
    if (serverId) {
        console.log('Entrando no servidor:', serverId);
        socket.emit('join-server', serverId);
        hideModal();
    } else {
        alert('Digite o ID do servidor');
    }
}

// Event Listeners
createServerBtn.addEventListener('click', () => {
    console.log('Botão criar servidor clicado');
    showModal('create');
});

joinServerBtn.addEventListener('click', () => {
    console.log('Botão entrar servidor clicado');
    showModal('join');
});

cancelServerBtn.addEventListener('click', () => {
    console.log('Botão cancelar clicado');
    hideModal();
});

// Fechar modal clicando fora
serverModal.addEventListener('click', (e) => {
    if (e.target === serverModal) {
        hideModal();
    }
});

// Fechar modal com ESC
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !serverModal.classList.contains('hidden')) {
        hideModal();
    }
});

// Confirmar ação do modal
confirmServerBtn.addEventListener('click', () => {
    console.log('Botão confirmar clicado');
    
    if (modalTitle.textContent === 'Criar Servidor') {
        createServer();
    } else {
        joinServer();
    }
});

// Permitir Enter para confirmar
serverNameInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        createServer();
    }
});

serverIdInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        joinServer();
    }
});

createChannelBtn.addEventListener('click', () => {
    if (currentServerId) {
        const channelName = prompt('Nome do canal:');
        if (channelName && channelName.trim()) {
            socket.emit('create-channel', { 
                serverId: currentServerId, 
                channelName: channelName.trim() 
            });
        }
    } else {
        alert('Crie ou entre em um servidor primeiro');
    }
});

// Socket Event Handlers
socket.on('connect', () => {
    console.log('Conectado ao servidor');
});

socket.on('disconnect', () => {
    console.log('Desconectado do servidor');
});

socket.on('server-created', (data) => {
    console.log('Servidor criado:', data);
    currentServerId = data.serverId;
    
    // Atualizar UI
    sidebar.classList.remove('hidden');
    noContent.classList.add('hidden');
    serverName.textContent = data.serverName;
    updateServerLink();
    
    // Limpar canais
    channelList.innerHTML = '';
    
    // Entrar no servidor automaticamente
    socket.emit('join-server', data.serverId);
    
    // Mostrar mensagem de sucesso
    alert(`Servidor criado! ID: ${data.serverId}\nCompartilhe este ID para convidar pessoas.`);
});

socket.on('server-info', (data) => {
    console.log('Informações do servidor:', data);
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

socket.on('error', (error) => {
    console.error('Erro:', error);
    alert('Erro: ' + error);
});

socket.on('channel-created', (channel) => {
    console.log('Canal criado:', channel);
    addChannelToList(channel);
});

socket.on('user-joined', (data) => {
    console.log('Usuário entrou:', data);
    if (isSharing) {
        createPeerConnection(data.userId);
        const pc = peerConnections.get(data.userId);
        pc.createOffer()
            .then(offer => pc.setLocalDescription(offer))
            .then(() => {
                socket.emit('offer', {
                    offer: pc.localDescription,
                    to: data.userId
                });
            })
            .catch(err => console.error('Erro ao criar oferta:', err));
    }
});

socket.on('user-list', (userList) => {
    console.log('Usuários no canal:', userList.length);
});

socket.on('existing-streamers', (streamers) => {
    console.log('Streamers existentes:', streamers);
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
        try {
            await pc.setRemoteDescription(data.offer);
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            socket.emit('answer', {
                answer: pc.localDescription,
                to: data.from
            });
        } catch (err) {
            console.error('Erro ao processar oferta:', err);
        }
    }
});

socket.on('answer', async (data) => {
    const pc = peerConnections.get(data.from);
    if (pc) {
        try {
            await pc.setRemoteDescription(data.answer);
        } catch (err) {
            console.error('Erro ao processar resposta:', err);
        }
    }
});

socket.on('ice-candidate', async (data) => {
    const pc = peerConnections.get(data.from);
    if (pc) {
        try {
            await pc.addIceCandidate(data.candidate);
        } catch (err) {
            console.error('Erro ao adicionar ICE candidate:', err);
        }
    }
});

socket.on('user-left', (userId) => {
    console.log('Usuário saiu:', userId);
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
        { urls: 'stun:stun1.l.google.com:19302' },
        {
            urls: 'turn:openrelay.metered.ca:80',
            username: 'openrelayproject',
            credential: 'openrelayproject'
        }
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
        
        // Notificar outros
        if (currentChannelId) {
            socket.emit('start-stream', { channelId: currentChannelId });
        }
        
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
    
    peerConnections.forEach((pc) => {
        pc.close();
    });
    peerConnections.clear();
    
    if (currentChannelId) {
        socket.emit('stop-stream', { channelId: currentChannelId });
    }
}

function createPeerConnection(userId) {
    if (peerConnections.has(userId)) {
        return peerConnections.get(userId);
    }
    
    const pc = new RTCPeerConnection(configuration);
    peerConnections.set(userId, pc);
    
    if (localStream) {
        localStream.getTracks().forEach(track => {
            pc.addTrack(track, localStream);
        });
    }
    
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
    
    document.querySelectorAll('.channel-item').forEach(item => {
        item.classList.remove('active');
    });
    
    const channelElement = document.querySelector(`[data-channel-id="${channel.id}"]`);
    if (channelElement) {
        channelElement.classList.add('active');
    }
    
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
    serverLink.onclick = () => {
        navigator.clipboard.writeText(currentServerId).then(() => {
            alert('ID do servidor copiado!');
        }).catch(() => {
            // Fallback
            const textarea = document.createElement('textarea');
            textarea.value = currentServerId;
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            textarea.remove();
            alert('ID do servidor copiado!');
        });
    };
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
    video.playsInline = true;
    
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
    video.playsInline = true;
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

console.log('App inicializado!');
