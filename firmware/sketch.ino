
#include <WiFi.h>
#include <DHTesp.h>
#include "Adafruit_MQTT.h"
#include "Adafruit_MQTT_Client.h"

// ========================================
// CLOUDTECH DATA CENTER
// Projeto Final - SENAC
// ESP32 + DHT22 + MQTT + Adafruit IO
// ========================================

// ========================================
// 1. CONFIGURACAO WI-FI
// ========================================

#define WLAN_SSID "Wokwi-GUEST"
#define WLAN_PASS ""

// ========================================
// 2. CONFIGURACAO ADAFRUIT IO
// ========================================

#define AIO_SERVER "io.adafruit.com"
#define AIO_SERVERPORT 1883

#define AIO_USERNAME "wanessags"
#define AIO_KEY "chave"

// Confira as Feed Keys no Adafruit IO
#define FEED_TEMPERATURA \
  AIO_USERNAME "/feeds/temperatura-do-data-center"

#define FEED_EXAUSTOR \
  AIO_USERNAME "/feeds/exaustor-data-center"

// ========================================
// 3. CONFIGURACAO HARDWARE
// ========================================

#define DHT_PIN 15
#define LED_PIN 2

const float LIMITE_TEMPERATURA = 28.0;

// ========================================
// 4. OBJETOS
// ========================================

DHTesp dhtSensor;

WiFiClient wifiClient;

Adafruit_MQTT_Client mqtt(
  &wifiClient,
  AIO_SERVER,
  AIO_SERVERPORT,
  AIO_USERNAME,
  AIO_KEY
);

// Publicar temperatura
Adafruit_MQTT_Publish temp_feed(
  &mqtt,
  FEED_TEMPERATURA
);

// Receber comandos do exaustor
Adafruit_MQTT_Subscribe led_sub(
  &mqtt,
  FEED_EXAUSTOR
);

// Publicar estado do exaustor
Adafruit_MQTT_Publish led_pub(
  &mqtt,
  FEED_EXAUSTOR
);

Adafruit_MQTT_Subscribe *subscription;

// ========================================
// 5. VARIAVEIS DO SISTEMA
// ========================================

float temperaturaAtual = NAN;

bool emEmergencia = false;
bool ledLigado = false;

// Protecao contra eco MQTT
bool ignorarEco = false;

String valorEco = "";

unsigned long instanteEco = 0;

// ========================================
// 6. CONTROLAR LED
// ========================================

void controlarLED(bool ligar) {

  ledLigado = ligar;

  digitalWrite(
    LED_PIN,
    ligar ? HIGH : LOW
  );

  Serial.print("Exaustor: ");
  Serial.println(
    ligar ? "LIGADO" : "DESLIGADO"
  );
}

// ========================================
// 7. PUBLICAR ESTADO DO LED
// ========================================

void publicarLED(bool ligar) {

  const char *valor = ligar ? "1" : "0";

  if (led_pub.publish(valor)) {

    ignorarEco = true;
    valorEco = valor;
    instanteEco = millis();

    Serial.print("Estado publicado: ");
    Serial.println(valor);

  } else {

    Serial.println(
      "Erro ao publicar estado do exaustor."
    );
  }
}

// ========================================
// 8. CONECTAR WI-FI
// ========================================

void conectarWiFi() {

  if (WiFi.status() == WL_CONNECTED) {
    return;
  }

  Serial.print("Conectando ao Wi-Fi");

  WiFi.begin(
    WLAN_SSID,
    WLAN_PASS,
    6
  );

  while (WiFi.status() != WL_CONNECTED) {

    delay(500);
    Serial.print(".");
  }

  Serial.println();
  Serial.println("Wi-Fi conectado!");

  Serial.print("IP: ");
  Serial.println(WiFi.localIP());
}

// ========================================
// 9. CONECTAR MQTT
// ========================================

void MQTT_connect() {

  if (mqtt.connected()) {
    return;
  }

  Serial.print("Conectando ao Adafruit IO");

  int8_t ret;

  while ((ret = mqtt.connect()) != 0) {

    Serial.println();

    Serial.print("Erro MQTT: ");
    Serial.println(
      mqtt.connectErrorString(ret)
    );

    mqtt.disconnect();

    Serial.println(
      "Tentando novamente em 3 segundos..."
    );

    delay(3000);
  }

  Serial.println();
  Serial.println("MQTT conectado!");

  // Sincroniza o estado apos reconectar,
  // desde que a temperatura seja conhecida.
  if (!isnan(temperaturaAtual)) {
    publicarLED(ledLigado);
  }
}

// ========================================
// 10. LER TEMPERATURA
// ========================================

void verificarTemperatura() {

  TempAndHumidity leitura =
    dhtSensor.getTempAndHumidity();

  if (isnan(leitura.temperature)) {

    Serial.println(
      "Erro ao ler temperatura do DHT22."
    );

    return;
  }

  temperaturaAtual = leitura.temperature;

  Serial.print("Temperatura atual: ");
  Serial.print(temperaturaAtual, 1);
  Serial.println(" C");

  // ======================================
  // EDGE COMPUTING
  // ======================================

  // Temperatura elevada
  if (temperaturaAtual >= LIMITE_TEMPERATURA) {

    if (!emEmergencia) {

      emEmergencia = true;

      Serial.println(
        "ALERTA! EMERGENCIA TERMICA!"
      );

      controlarLED(true);

      // Sincroniza os dois dashboards
      publicarLED(true);

    } else if (!ledLigado) {

      controlarLED(true);
    }

  } else {

    // Retorno automatico ao esfriar
    if (emEmergencia) {

      emEmergencia = false;

      Serial.println(
        "Temperatura normalizada!"
      );

      controlarLED(false);

      publicarLED(false);
    }
  }
}

// ========================================
// 11. PROCESSAR COMANDOS MQTT
// ========================================

void processarComandoLED() {

  String comando = String(
    (char *)led_sub.lastread
  );

  comando.trim();
  comando.toLowerCase();

  Serial.print("Comando recebido: ");
  Serial.println(comando);

  // ======================================
  // FILTRO ANTI-ECO
  // ======================================

  if (ignorarEco) {

    if (millis() - instanteEco > 3000) {

      ignorarEco = false;
      valorEco = "";

    } else if (comando == valorEco) {

      ignorarEco = false;
      valorEco = "";

      Serial.println(
        "Eco MQTT ignorado."
      );

      return;
    }
  }

  // ======================================
  // COMANDO PARA LIGAR
  // ======================================

  if (comando == "1" || comando == "on") {

    Serial.println(
      "Solicitacao para ligar o exaustor."
    );

    controlarLED(true);

    return;
  }

  // ======================================
  // COMANDO PARA DESLIGAR
  // ======================================

  if (comando == "0" || comando == "off") {

    Serial.println(
      "Solicitacao para desligar o exaustor."
    );

    // Falha do sensor:
    // manter protecao por seguranca
    if (isnan(temperaturaAtual)) {

      Serial.println(
        "BLOQUEADO: temperatura desconhecida!"
      );

      controlarLED(true);
      publicarLED(true);

      return;
    }

    // TRAVA TERMICA
    if (temperaturaAtual >= LIMITE_TEMPERATURA
        || emEmergencia) {

      Serial.println(
        "BLOQUEADO: temperatura >= 28 C!"
      );

      Serial.println(
        "O exaustor deve permanecer ligado."
      );

      controlarLED(true);

      // Faz o Toggle voltar para 1
      publicarLED(true);

      return;
    }

    // Temperatura normal:
    // desligamento permitido
    controlarLED(false);

    Serial.println(
      "Desligamento manual permitido."
    );

    return;
  }

  Serial.println(
    "Comando MQTT desconhecido."
  );
}

// ========================================
// 12. SETUP
// ========================================

void setup() {

  Serial.begin(115200);

  pinMode(LED_PIN, OUTPUT);

  controlarLED(false);

  dhtSensor.setup(
    DHT_PIN,
    DHTesp::DHT22
  );

  conectarWiFi();

  mqtt.subscribe(&led_sub);

  Serial.println();
  Serial.println("================================");
  Serial.println("CLOUDTECH DATA CENTER");
  Serial.println("Projeto Final - Cloud e IoT");
  Serial.println("ESP32 + DHT22 + Adafruit IO");
  Serial.println("Limite termico: 28 C");
  Serial.println("================================");
}

// ========================================
// 13. LOOP PRINCIPAL
// ========================================

void loop() {

  // Verificar Wi-Fi
  if (WiFi.status() != WL_CONNECTED) {
    conectarWiFi();
  }

  // Verificar conexao MQTT
  MQTT_connect();

  // ======================================
  // DESAFIO 1:
  // QUATRO CICLOS DE 1 SEGUNDO
  // ======================================

  for (int i = 0; i < 4; i++) {

    unsigned long inicioCiclo = millis();

    // Leitura local e protecao Edge
    verificarTemperatura();

    // ====================================
    // DESAFIO 3:
    // ESCUTAR COMANDOS POR ATE 1000MS
    // ====================================

    while (millis() - inicioCiclo < 1000) {

      unsigned long restante =
        1000 - (millis() - inicioCiclo);

      subscription = mqtt.readSubscription(
        (uint16_t)restante
      );

      if (subscription == &led_sub) {

        processarComandoLED();
      }
    }
  }

  // ======================================
  // DESAFIO 4:
  // PUBLICAR TEMPERATURA A CADA CICLO
  // ======================================

  if (!isnan(temperaturaAtual)) {

    if (temp_feed.publish(temperaturaAtual)) {

      Serial.print(
        "Telemetria enviada: "
      );

      Serial.print(temperaturaAtual, 1);

      Serial.println(" C");

    } else {

      Serial.println(
        "ERRO: falha ao enviar temperatura."
      );
    }
  }
}
