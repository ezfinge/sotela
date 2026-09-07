const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const path = require('path');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);

const io = socketIO(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    transports: ['websocket', 'polling']
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const servers = new Map();
const channels = new Map();

function generateId() {
    return crypto.randomBytes(4).toString('hex');
}

io.on('connection', (socket) => {
    console.log('✅ Novo cliente conectado:', socket.id);

    // CRIAR SERVIDOR
    socket.on('create-server', (serverName) => {
        const serverId = generateId();
        const channelId = generateId();
        
        const defaultChannel = {
            id: channelId,
            name: 'geral',
            serverId: serverId,
            users: new Set()
        };
        
        const newServer = {
            id: serverId,
            name: serverName || 'Servidor',
            channels: new Map([[channelId, defaultChannel]])
        };
        
        servers.set(serverId, newServer);
        channels.set(channelId, defaultChannel);
        
        socket.emit('server-created', { 
            serverId: serverId, 
            serverName: newServer.name 
        });
        
        console.log('✅ Servidor criado:', serverId);
    });

    // ENTRAR EM SERVIDOR
    socket.on('join-server', (serverId) => {
        const server = servers.get(serverId);
        
        if (server) {
            socket.join(serverId);
            socket.data.serverId = serverId;
            
            socket.emit('server-info', {
                id: server.id,
                name: server.name,
                channels: Array.from(server.channels.values()).map(c => ({ 
                    id: c.id, 
                    name: c.name 
                }))
            });
        } else {
            socket.emit('error', 'Servidor não encontrado');
        }
    });

    // CRIAR CANAL
    socket.on('create-channel', (data) => {
        const { serverId, channelName } = data;
        const server = servers.get(serverId);
        
        if (server) {
            const channelId = generateId();
            const newChannel = {
                id: channelId,
                name: channelName || 'novo-canal',
                serverId: serverId,
                users: new Set()
            };
            
            server.channels.set(channelId, newChannel);
            channels.set(channelId, newChannel);
            
            io.to(serverId).emit('channel-created', { 
                id: channelId, 
                name: newChannel.name 
            });
        }
    });

    // ENTRAR EM CANAL
    socket.on('join-channel', (data) => {
        const { channelId } = data;
        const channel = channels.get(channelId);
        
        if (channel) {
            socket.join(channelId);
            channel.users.add(socket.id);
            socket.data.channelId = channelId;
            
            // Enviar lista de usuários no canal
            const userList = Array.from(channel.users);
            
            // Notificar TODOS no canal sobre o novo usuário
            io.to(channelId).emit('user-joined', { 
                userId: socket.id,
                userList: userList
            });
            
            // Se há outros usuários, informar ao novo usuário
            const existingUsers = userList.filter(id => id !== socket.id);
            if (existingUsers.length > 0) {
                socket.emit('existing-users', existingUsers);
            }
            
            console.log('✅ Usuário', socket.id, 'entrou no canal', channelId);
            console.log('👥 Usuários no canal:', userList.length);
        }
    });

    // SAIR DO CANAL
    socket.on('leave-channel', (channelId) => {
        const channel = channels.get(channelId);
        if (channel) {
            channel.users.delete(socket.id);
            socket.leave(channelId);
            io.to(channelId).emit('user-left', socket.id);
        }
    });

    // ============ WEBRTC SINALIZAÇÃO ============
    
    // Quando alguém começa a compartilhar
    socket.on('start-stream', (data) => {
        console.log('📡 Usuário', socket.id, 'começou a transmitir no canal', data.channelId);
        
        // Notificar todos no canal EXCETO o transmissor
        socket.to(data.channelId).emit('stream-started', { 
            userId: socket.id 
        });
    });

    // Oferta WebRTC
    socket.on('offer', (data) => {
        console.log('📤 Oferta de', socket.id, 'para', data.to);
        if (data.to) {
            socket.to(data.to).emit('offer', {
                offer: data.offer,
                from: socket.id
            });
        }
    });

    // Resposta WebRTC
    socket.on('answer', (data) => {
        console.log('📥 Resposta de', socket.id, 'para', data.to);
        if (data.to) {
            socket.to(data.to).emit('answer', {
                answer: data.answer,
                from: socket.id
            });
        }
    });

    // ICE Candidate
    socket.on('ice-candidate', (data) => {
        if (data.to) {
            socket.to(data.to).emit('ice-candidate', {
                candidate: data.candidate,
                from: socket.id
            });
        }
    });

    // Parar transmissão
    socket.on('stop-stream', (data) => {
        console.log('🛑 Usuário', socket.id, 'parou de transmitir');
        socket.to(data.channelId).emit('stream-stopped', { 
            userId: socket.id 
        });
    });

    // DESCONECTAR
    socket.on('disconnect', () => {
        console.log('❌ Cliente desconectado:', socket.id);
        
        channels.forEach((channel, channelId) => {
            if (channel.users.has(socket.id)) {
                channel.users.delete(socket.id);
                io.to(channelId).emit('user-left', socket.id);
            }
        });
    });
});

let isListening = false;

function startServer() {
    if (isListening) return;

    const PORT = process.env.PORT || 10000;
    
    try {
        server.listen(PORT, '0.0.0.0', () => {
            isListening = true;
            console.log('✅ Servidor rodando na porta', PORT);
        });

        server.on('error', (error) => {
            console.error('❌ Erro no servidor:', error);
        });

    } catch (error) {
        console.error('❌ Erro ao iniciar:', error);
    }
}

startServer();

setInterval(() => {
    console.log('💓 Keep alive -', new Date().toISOString());
}, 300000);

process.on('uncaughtException', (error) => {
    console.error('❌ Erro não capturado:', error);
});

process.on('SIGTERM', () => {
    server.close(() => process.exit(0));
});
