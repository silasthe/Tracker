const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

app.use(express.static(path.join(__dirname, 'public')));

const lobbies = {};

io.on('connection', (socket) => {
    socket.on('joinLobby', ({ lobbyId, userName, isHost }) => {
        socket.join(lobbyId);
        socket.lobbyId = lobbyId;
        socket.userName = userName;
        socket.isHost = isHost;
        socket.updateInterval = 5000;

        // Always use the correct structure
        if (!lobbies[lobbyId]) {
            lobbies[lobbyId] = { users: {}, boxes: [] };
        }

        lobbies[lobbyId].users[socket.id] = { name: userName, location: null, interval: 5000, isHost };

        // Send all boxes to the new user
        socket.emit('boxList', lobbies[lobbyId].boxes);

        io.to(lobbyId).emit('userList', lobbies[lobbyId].users);
    });

    socket.on('locationUpdate', (location) => {
        const lobby = lobbies[socket.lobbyId];
        if (lobby && lobby.users[socket.id]) {
            lobby.users[socket.id].location = location;
            io.to(socket.lobbyId).emit('userList', lobby.users);
        }
    });

    socket.on('setUpdateInterval', (interval) => {
        if (socket.isHost) {
            for (const id in lobbies[socket.lobbyId].users) {
                lobbies[socket.lobbyId].users[id].interval = interval;
            }
            io.to(socket.lobbyId).emit('updateInterval', interval);
        }
    });

    socket.on('drawBox', (boxBounds) => {
        if (socket.isHost) {
            // Store and broadcast the box
            lobbies[socket.lobbyId].boxes.push(boxBounds);
            io.to(socket.lobbyId).emit('newBox', boxBounds);
        }
    });

    socket.on('draw-box', (box) => {
        io.emit('draw-box', box);
    });

    socket.on('draw-rectangle', (bounds) => {
        io.emit('draw-rectangle', bounds);
    });

    socket.on('disconnect', () => {
        const lobby = lobbies[socket.lobbyId];
        if (lobby) {
            delete lobby.users[socket.id];
            io.to(socket.lobbyId).emit('userList', lobby.users);
        }
    });
});

server.listen(3000, () => {
    console.log('Server kører på http://localhost:3000');
});