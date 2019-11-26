const functions = require('firebase-functions');
const {Storage} = require('@google-cloud/storage');
const os = require('os');
const path = require('path');
const cors = require('cors')({origin:true});
const Busboy = require('busboy');
const fs = require('fs');

const projectId = 'fyp-test-db';

const gcs = new Storage({
    projectId: projectId,
  });

var admin = require("firebase-admin");
var serviceAccount = require("./serviceAccountKey.json");

admin.initializeApp({
credential: admin.credential.cert(serviceAccount),
databaseURL: "https://fyp-test-db.firebaseio.com/"

});







exports.onFileChange = functions.storage.object().onFinalize((object, context) => {

    const bucket = object.bucket;
    const contentType = object.contentType;
    const filePath = object.name;
    console.log('File change detected, funcion execution started');


    if(path.basename(filePath).startsWith('renamed-')){
        console.log('Already renamed the file')
        return;
    }

    const destBucket = gcs.bucket(bucket);
    const tmpFilePath = path.join(os.tmpdir(),path.basename(filePath));
    const metadata = {contentType:contentType};

    return destBucket.file(filePath).download({
        destination:tmpFilePath
    }).then(()=>{
        return destBucket.upload(tmpFilePath,{
        destination:'renamed-' + path.basename(filePath),
        metadata : metadata
        })
    });
});



exports.onFileDelete = functions.storage.object().onDelete(event => {
    console.log(event);
    return;
});



exports.onDataAdded = functions.database.ref('/message/{id}').onCreate((snap, context)=>{
    const data = snap.val();
    const newData = {
        msg : snap.key + ' - ' + data.msg.toUpperCase()
    };
    console.log(snap.key);
    return snap.ref.parent.child('copiedData').set(newData);
    
});





var db = admin.database();
var ref = db.ref("deviceDataStore");


exports.connData = functions.https.onRequest((req, res) => {
  cors(req, res, () => {
      const usersRef = ref.child(`${req.body.deviceID}`);

      if (req.method !== 'POST') {
          return res.status(500).json({
              message: 'Not allowed'
          })
      } else {
          return usersRef.set(
            req.body
          ).then(() => {
              res.status(200).json({
                  message: req.body
              });
              return res.status(200)
          }).catch(error => {
              return res.status(500).send(error);
          })
      }
  })

});


///////////////////////////////Cloud Messagging//////////////////////////////////////////////////////////


exports.sendAdminNotification = functions.database.ref('/News/{pushId}').onCreate((snap,context) => {
    const news= snap.val();
         if(news.priority===1){
         const payload = {notification: {
             title: 'New news',
             body: `${news.title}`
             }
         };
         
    return admin.messaging().sendToTopic("News",payload)
        .then(function(response){
             console.log('Notification sent successfully:',response);
        }) 
        .catch(function(error){
             console.log('Notification sent failed:',error);
        });
        }
    });

  
    
//////////////     Read DB Value from   ////////////////////////


exports.optimumDevices = functions.https.onRequest((req, res) => {
    cors(req, res, () => {
        if (req.method !== 'POST') {
            return res.status(500).json({
                message: 'Not allowed'
            })

        } else {
            const query = admin.database().ref("/deviceDataStore/")
           .orderByChild("batteryLevel")
           .limitToLast(2);

            query.once('value', function (snapshot) {
                var twoDevices = [];
                snapshot.forEach(function (childSnapshot) {
                    var childKey = childSnapshot.key;
                    var childData = childSnapshot.child("deviceID").val();
                
                    twoDevices.push(childData);

                    console.log(twoDevices);

                    admin.database().ref("/News/newsid2").update({
                        "description" : "Test description",
                        "priority" : 1,
                        "title" : `${twoDevices}`
                    });
                
                });
            return res.status(200).json({
                pairingdevices : twoDevices
                });

        });
           
        };
    });
  
  });




class DeviceParameters{
    constructor (name){
        this.reqdeviceID = name;
        this.deviceValues = admin.database().ref("/deviceDataStore/" + this.reqdeviceID);
    };

    deviceRSSI(){
        var rssi ;
        this.deviceValues.on("value", function(snapshot) {
             rssi = snapshot.child("connRSSI").val();
        });  
        return rssi;
    };

    deviceBatteryLevel() {
        this.deviceValues.on("value", function(snapshot) {
            return snapshot.child("batteryLevel").val();
        });  
    };

    deviceLinkSpeed(){
        this.deviceValues.on("value", function(snapshot) {
            return snapshot.child("linkSpeed").val();
        });  
    };
    
};

let a = new DeviceParameters("0001");
console.log(a.deviceRSSI());


    

 
  





