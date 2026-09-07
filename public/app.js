// Conexão Socket.IO
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

// ================= FUNÇÕES DO MODAL =================
function openModal(mode) {
    console.log('Abrindo modal:', mode);
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
    console.log('Fechando modal');
    modalOpen = false;
    serverModal.classList.add('hidden');
    serverModal.classList.remove('active');
    serverModal.style.display = 'none';
}

// ================= FUNÇÃO DE CONVITE =================
function updateInviteLink(serverId) {
    const baseUrl = window.location.origin;
    const inviteUrl = `${baseUrl}/?server=${serverId}`;
    inviteLinkInput.value = inviteUrl;
    inviteId.textContent = serverId;
}

// ================= EVENTOS DOS BOTÕES =================
createServerBtn.addEventListener('click', () => {
    openModal('create');
});

joinServerBtn.addEventListener('click', () => {
    openModal('join');
});

cancelServerBtn.addEventListener('click', () => {
    closeModal();
});

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

// Fechar com ESC
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modalOpen) {
        closeModal();
    }
});

// Fechar clicando fora
serverModal.addEventListener('click', (e) => {
    if (e.target === serverModal) {
        closeModal();
    }
});

// Enter nos inputs
serverNameInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        confirmServerBtn.click();
    }
});

serverIdInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        confirmServerBtn.click();
    }
});

// Copiar link de convite
copyInviteBtn.addEventListener('click', () => {
    inviteLinkInput.select();
    inviteLinkInput.setSelectionRange(0, 99999);
    document.execCommand('copy');
    alert('✅ Link copiado!');
});

// Copiar ID
copyIdBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(currentServerId).then(() => {
        alert('✅ ID copiado!');
    });
});

// ================= SOCKET EVENTS =================
socket.on('connect', () => {
    console.log('✅ Conectado ao servidor');
});

socket.on('disconnect', () => {
    console.log('❌ Desconectado do servidor');
});

socket.on('server-created', (data) => {
    console.log('🎉 Servidor criado:', data);
    currentServerId = data.serverId;
    sidebar.classList.remove('hidden');
    serverName.textContent = data.serverName;
    updateInviteLink(data.serverId);
    socket.emit('join-server', data.serverId);
});

socket.on('server-info', (data) => {
    console.log('📋 Info do servidor:', data);
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
    console.log('➕ Canal criado:', channel);
    addChannelToList(channel);
});

socket.on('user-joined', (data) => {
    console.log('👤 Usuário entrou:', data.userId);
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

socket.on('existing-streamers', (streamers) => {
    console.log('📡 Streamers existentes:', streamers);
    streamers.forEach(streamerId => {
        if (streamerId !== socket.id) {
            createPeerConnection(streamerId);
        }
    });
});

socket.on('offer', async (data) => {
    console.log('📥 Recebida oferta de:', data.from);
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
    console.log('👋 Usuário saiu:', userId);
    if (peerConnections.has(userId)) {
        peerConnections.get(userId).close();
        peerConnections.delete(userId);
    }
    removeRemoteVideo(userId);
});

socket.on('error', (error) => {
    console.error('⚠️ Erro:', error);
    alert('Erro: ' + error);
});

// ================= FUNÇÕES DE CANAL =================
function addChannelToList(channel) {
    const li = document.createElement('li');
    li.className = 'channel-item';
    li.textContent = `# ${channel.name}`;
    li.dataset.channelId = channel.id;
    li.addEventListener('click', () => joinChannel(channel));
    channelList.appendChild(li);
}

function joinChannel(channel) {
    console.log('🔗 Entrando no canal:', channel.name);
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
        console.log('📺 Recebendo track remota de:', userId);
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
    label.textContent = `🖥️ Tela de ${userId.slice(0, 8)}`;
    
    videoContainer.appendChild(video);
    videoContainer.appendChild(label);
    screensContainer.appendChild(videoContainer);
}

function removeRemoteVideo(userId) {
    const videoContainer = document.getElementById(`remote-video-${userId}`);
    if (videoContainer) {
        videoContainer.remove();
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

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
    }
    peerConnections.forEach(pc => pc.close());
});

console.log('🚀 App carregado com sucesso!');
console.log('📝 Como usar:');
console.log('   1. Crie um servidor ou entre em um existente');
console.log('   2. Compartilhe o link de convite');
console.log('   3. Clique em "Compartilhar Tela" para transmitir');
