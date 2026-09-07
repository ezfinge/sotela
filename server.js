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

function generateId() {
    return crypto.randomBytes(4).toString('hex');
}

io.on('connection', (socket) => {
    console.log('✅ Novo cliente conectado:', socket.id);

    // CRIAR SERVIDOR
    socket.on('create-server', (serverName) => {
        const serverId = generateId();
        
        const newServer = {
            id: serverId,
            name: serverName || 'Servidor',
            users: new Map() // socketId -> { isSharing: false }
        };
        
        newServer.users.set(socket.id, { isSharing: false });
        
        servers.set(serverId, newServer);
        socket.join(serverId);
        socket.data.serverId = serverId;
        
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
            server.users.set(socket.id, { isSharing: false });
            socket.data.serverId = serverId;
            
            // Enviar informações do servidor
            socket.emit('server-info', {
                id: server.id,
                name: server.name
            });
            
            // Enviar lista de usuários que JÁ estão transmitindo
            const existingStreamers = [];
            server.users.forEach((userData, userId) => {
                if (userId !== socket.id && userData.isSharing) {
                    existingStreamers.push(userId);
                }
            });
            
            if (existingStreamers.length > 0) {
                console.log('📡 Transmissores existentes:', existingStreamers);
                socket.emit('existing-streamers', existingStreamers);
            }
            
            // Notificar outros sobre novo usuário
            socket.to(serverId).emit('user-joined', { 
                userId: socket.id 
            });
            
            console.log('✅ Cliente entrou no servidor:', serverId);
        } else {
            socket.emit('error', 'Servidor não encontrado');
        }
    });

    // INICIAR TRANSMISSÃO
    socket.on('start-stream', () => {
        const serverId = socket.data.serverId;
        console.log('📡 Usuário', socket.id, 'iniciou transmissão no servidor', serverId);
        
        if (serverId) {
            const server = servers.get(serverId);
            if (server) {
                // Marcar como transmitindo
                const userData = server.users.get(socket.id);
                if (userData) {
                    userData.isSharing = true;
                }
                
                // Notificar TODOS os outros usuários
                socket.to(serverId).emit('stream-started', { 
                    userId: socket.id 
                });
                
                console.log('📡 Notificando outros usuários sobre nova transmissão');
            }
        }
    });

    // PARAR TRANSMISSÃO
    socket.on('stop-stream', () => {
        const serverId = socket.data.serverId;
        console.log('🛑 Usuário', socket.id, 'parou transmissão');
        
        if (serverId) {
            const server = servers.get(serverId);
            if (server) {
                const userData = server.users.get(socket.id);
                if (userData) {
                    userData.isSharing = false;
                }
                
                socket.to(serverId).emit('stream-stopped', { 
                    userId: socket.id 
                });
            }
        }
    });

    // OFERTA WEBRTC
    socket.on('offer', (data) => {
        console.log('📤 Oferta de', socket.id, 'para', data.to);
        if (data.to) {
            socket.to(data.to).emit('offer', {
                offer: data.offer,
                from: socket.id
            });
        }
    });

    // RESPOSTA WEBRTC
    socket.on('answer', (data) => {
        console.log('📥 Resposta de', socket.id, 'para', data.to);
        if (data.to) {
            socket.to(data.to).emit('answer', {
                answer: data.answer,
                from: socket.id
            });
        }
    });

    // ICE CANDIDATE
    socket.on('ice-candidate', (data) => {
        if (data.to) {
            socket.to(data.to).emit('ice-candidate', {
                candidate: data.candidate,
                from: socket.id
            });
        }
    });

    // DESCONECTAR
    socket.on('disconnect', () => {
        console.log('❌ Cliente desconectado:', socket.id);
        
        const serverId = socket.data.serverId;
        if (serverId) {
            const server = servers.get(serverId);
            if (server) {
                server.users.delete(socket.id);
                socket.to(serverId).emit('user-left', socket.id);
                
                if (server.users.size === 0) {
                    servers.delete(serverId);
                    console.log('🗑️ Servidor removido:', serverId);
                }
            }
        }
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
