import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import {
  StyleSheet,
  Text,
  View,
  Image,
  TouchableOpacity,
  Pressable,
  TouchableWithoutFeedback,
  TextInput,
  useColorScheme,
  ScrollView,
  Platform,
  StatusBar,
  Animated,
  Easing,
  PanResponder,
  Dimensions,
  Modal,
  ActivityIndicator,
  FlatList,
  Linking,
  LayoutAnimation,
  BackHandler,
  AppState,
  Keyboard,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { CameraView, useCameraPermissions, scanFromURLAsync } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import * as LocalAuthentication from 'expo-local-authentication';
import * as Brightness from 'expo-brightness';
import * as Location from 'expo-location';
import * as Application from 'expo-application';
import * as SystemUI from 'expo-system-ui';
import Barcode from 'react-native-barcode-svg';
import QRCode from 'react-native-qrcode-svg';
import { InstalledApps, RNLauncherKitHelper } from 'react-native-launcher-kit';

import {
  Settings,
  ArrowLeft,
  Plus,
  Minus,
  ChevronDown,
  Camera,
  Image as ImageIcon,
  Trash2,
  X,
  Check,
  AppWindow,
  Edit,
  Download,
  Upload,
  Share2,
  Fingerprint,
  RefreshCw,
  Lock,
  Search,
  Heart,
  Ban,
  ScanLine,
  Moon,
  Link2,
  EyeOff,
  MapPin,
  Sun,
  Palette,
  GripVertical,
  RotateCw,
  Languages,
} from 'lucide-react-native';

const DEVELOPER_GITHUB_URL = 'https://github.com/akosdevhu/QuickWallet';
const DEVELOPER_INSTAGRAM_URL = 'https://www.instagram.com/akosdevhu/';
const DEVELOPER_EMAIL_URL = 'mailto:akosdevhu@gmail.com';
const GITHUB_REPO_SLUG = 'akosdevhu/QuickWallet';

// Üdvözlő / újdonságok ablak: a kulcs a verzióhoz kötött, így egy későbbi
// verziónál (pl. 1.1) elég a kulcsot és a címkét átírni, és újra megjelenik.
const WELCOME_SEEN_KEY = '@welcome_seen_v1_0';
const WELCOME_VERSION_LABEL = '1.0';

const THEME_BG_COLORS = {
  dark: '#0f172a',
  amoled: '#000000',
  light: '#f8fafc',
};

const BRIGHTNESS_BOOST_LEVELS = [0.3, 0.65, 1.0];

const CARD_HEIGHT = 190;
const DRAG_HANDLE_WIDTH = 20;
const AnimatedTouchableOpacity = Animated.createAnimatedComponent(TouchableOpacity);
const VISIBLE_HEADER = 75;
const EXTRA_GAP = 30;
const EXPANDED_GAP = 15;

// A kártyalista ScrollView-jának fix belső térközei. Ezekkel számoljuk ki,
// hogy a kártyák elférnek-e az oldalon (a lenti 120 px a + gomb miatti
// szabad hely, hogy az utolsó kártyát ne takarja ki).
const LIST_PADDING_TOP = 10;
const LIST_PADDING_BOTTOM = 120;
const STACK_MARGIN_TOP = 15;
const LIST_CHROME_HEIGHT = LIST_PADDING_TOP + LIST_PADDING_BOTTOM + STACK_MARGIN_TOP;

// Ennyi idő alatt csúszik le teljesen a hozzáadó sheet (Modal slide
// animáció). Az új kártya hozzáadási animációja ennyi késleltetéssel indul.
const SHEET_CLOSE_DURATION = 350;
// Az új kártya sheet legfeljebb a státuszsáv aljáig csúszhat fel.
const ADD_SHEET_TOP_INSET =
  Platform.OS === 'android' ? (StatusBar.currentHeight || 24) : 50;

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// ---------------------------------------------------------------------------
// Helyalapú kártya-előrehozás
// A telefon pozíciója alapján az OpenStreetMap Overpass szolgáltatástól
// lekérjük a közeli üzleteket (kulcs, fiók és kártyaadat nélkül). A szolgáltatás
// azt a pozíciót kapja, amit a telefon a megadott helyengedély mellett ad
// (pontos vagy hozzávetőleges, a felhasználó döntése szerint). Az egyezést
// (melyik üzlet van 100 méteren belül, melyik kártya neve egyezik) a telefon
// számolja ki helyben. Ha nincs net, nem történik semmi, nincs hibaüzenet.
// ---------------------------------------------------------------------------
const NEARBY_RADIUS_M = 100; // ekkora körzetben számít "bent vagyok a boltban"-nak
const NEARBY_QUERY_RADIUS_M = 150; // a lekérdezés ennél kicsit nagyobb, hogy mozgás közben is jó legyen
const NEARBY_REQUERY_MOVE_M = 40; // ennyi mozgás után kérdezünk újra
const NEARBY_MEMO_TTL_MS = 10 * 60 * 1000; // egy helyben állva ennyi után kérdezünk újra
const NEARBY_MAX_ACCURACY_M = 250; // ennél pontatlanabb helyből (pl. hozzávetőleges engedély) nem döntünk
const NEARBY_RETRY_AFTER_FAIL_MS = 2 * 60 * 1000;
const NEARBY_POLL_MS = 60 * 1000; // nyitott appnál ilyen gyakran nézzük a helyet
const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

const normalizeName = (value) =>
  (value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

// Szóhatáros egyezés: "Spar" ~ "Spar Market", de a "dm" nem egyezik az "admin"-nal.
const namesMatch = (a, b) => {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const [short, long] = na.length <= nb.length ? [na, nb] : [nb, na];
  if (short.length < 2) return false;
  return (' ' + long + ' ').includes(' ' + short + ' ');
};

const distanceMeters = (lat1, lon1, lat2, lon2) => {
  const toRad = (d) => (d * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
};

// 15 mp-nél tovább nem várunk a helyre; ilyenkor az utolsó ismert pozíció jön.
const getDevicePosition = async () => {
  try {
    return await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), 15000)
      ),
    ]);
  } catch (e) {
    const last = await Location.getLastKnownPositionAsync({
      maxAge: 5 * 60 * 1000,
    });
    if (last) return last;
    throw e;
  }
};

let nearbyMemo = null; // az utolsó sikeres lekérdezés (hely, idő, üzletek)
let nearbyLastFailAt = 0;

const resetNearbyMemo = () => {
  nearbyMemo = null;
  nearbyLastFailAt = 0;
};

// Visszaadja a pozíció körüli üzleteket: [[név, lat, lon], ...]. Ha nincs net
// vagy a lekérdezés nem sikerül, csendben null-t ad.
const getPlacesForPosition = async (lat, lon) => {
  const now = Date.now();
  if (
    nearbyMemo &&
    now - nearbyMemo.t < NEARBY_MEMO_TTL_MS &&
    distanceMeters(nearbyMemo.lat, nearbyMemo.lon, lat, lon) < NEARBY_REQUERY_MOVE_M
  ) {
    return nearbyMemo.p;
  }
  if (now - nearbyLastFailAt < NEARBY_RETRY_AFTER_FAIL_MS) return null;

  const around = `(around:${NEARBY_QUERY_RADIUS_M},${lat.toFixed(6)},${lon.toFixed(6)})`;
  const query =
    `[out:json][timeout:15];(` +
    `nwr["shop"]["name"]${around};` +
    `nwr["amenity"~"^(fuel|pharmacy|cafe|restaurant|fast_food)$"]["name"]${around};` +
    `);out tags center;`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(OVERPASS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'data=' + encodeURIComponent(query),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const json = await res.json();
    const places = [];
    for (const el of json.elements || []) {
      const pLat = el.lat ?? el.center?.lat;
      const pLon = el.lon ?? el.center?.lon;
      if (pLat == null || pLon == null) continue;
      const tags = el.tags || {};
      [tags.name, tags.brand].forEach((n) => {
        if (n) places.push([n, pLat, pLon]);
      });
    }
    nearbyMemo = { lat, lon, t: now, p: places };
    nearbyLastFailAt = 0;
    return places;
  } catch (e) {
    nearbyLastFailAt = now;
    return null;
  } finally {
    clearTimeout(timer);
  }
};

const animateLayout = () => {
  LayoutAnimation.configureNext(
    LayoutAnimation.create(
      220,
      LayoutAnimation.Types.easeInEaseOut,
      LayoutAnimation.Properties.opacity
    )
  );
};

// Fejléc-elhalványítás: a görgetett tartalom a fejléc alatt fokozatosan
// beleolvad a háttérbe (külső függőség nélkül, egymásra rakott sávokból).
const HEADER_FADE_HEIGHT = 34;
const HEADER_FADE_STEPS = 17;

const HeaderFade = React.memo(function HeaderFade({ color, scrollY }) {
  const r = parseInt(color.slice(1, 3), 16);
  const g = parseInt(color.slice(3, 5), 16);
  const b = parseInt(color.slice(5, 7), 16);
  const opacity = scrollY.interpolate({
    inputRange: [0, 24],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });
  const stepHeight = HEADER_FADE_HEIGHT / HEADER_FADE_STEPS;

  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: HEADER_FADE_HEIGHT,
        opacity,
        zIndex: 5,
      }}
    >
      {Array.from({ length: HEADER_FADE_STEPS }, (_, i) => {
        const p = 1 - (i + 0.5) / HEADER_FADE_STEPS;
        const alpha = p * p * (3 - 2 * p);
        return (
          <View
            key={i}
            style={{
              height: stepHeight,
              backgroundColor: `rgba(${r},${g},${b},${alpha.toFixed(3)})`,
            }}
          />
        );
      })}
    </Animated.View>
  );
});

// Egyedi Alert Komponens (Kapszula stílusú gombokkal)
const CustomAlert = ({
  visible,
  title,
  message,
  buttons = [],
  onClose,
  footerLink = null,
  isDarkMode = false,
  amoledMode = false,
}) => {
  const scaleAnim = useRef(new Animated.Value(0.9)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      scaleAnim.setValue(0.9);
      opacityAnim.setValue(0);
      Animated.parallel([
        Animated.spring(scaleAnim, {
          toValue: 1,
          friction: 8,
          tension: 160,
          useNativeDriver: true,
        }),
        Animated.timing(opacityAnim, {
          toValue: 1,
          duration: 220,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [visible]);

  if (!visible) return null;

  return (
    <Modal transparent animationType="fade" visible={visible} onRequestClose={onClose}>
      <View style={alertStyles.overlay}>
        <Animated.View
          style={[
            alertStyles.alertContainer,
            isDarkMode &&
              (amoledMode
                ? alertStyles.alertContainerAmoled
                : alertStyles.alertContainerDark),
            { opacity: opacityAnim, transform: [{ scale: scaleAnim }] },
          ]}
        >
          <Text style={[alertStyles.title, isDarkMode && alertStyles.titleDark]}>
            {title}
          </Text>
          {message ? (
            <Text style={[alertStyles.message, isDarkMode && alertStyles.messageDark]}>
              {message}
            </Text>
          ) : null}
          <View style={alertStyles.buttonContainer}>
            {buttons.map((btn, index) => {
              const isDestructive = btn.style === 'destructive';
              const isCancel = btn.style === 'cancel';

              return (
                <TouchableOpacity
                  key={index}
                  style={[
                    alertStyles.button,
                    isDestructive
                      ? alertStyles.destructiveButton
                      : isCancel
                      ? alertStyles.cancelButton
                      : alertStyles.defaultButton,
                  ]}
                  activeOpacity={0.8}
                  onPress={() => {
                    if (btn.onPress) btn.onPress();
                    onClose();
                  }}
                >
                  <Text style={alertStyles.buttonText}>
                    {btn.text}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
          {footerLink ? (
            <TouchableOpacity
              style={alertStyles.footerLinkWrap}
              activeOpacity={0.6}
              hitSlop={{ top: 8, bottom: 8, left: 12, right: 12 }}
              onPress={() => {
                onClose();
                if (footerLink.onPress) footerLink.onPress();
              }}
            >
              <Text
                style={[
                  alertStyles.footerLinkText,
                  isDarkMode && alertStyles.footerLinkTextDark,
                ]}
              >
                {footerLink.text}
              </Text>
            </TouchableOpacity>
          ) : null}
        </Animated.View>
      </View>
    </Modal>
  );
};

// Üdvözlő ablak: egyszer jelenik meg az első indításkor, utána az
// "Ellenőrzés most" alertből hozható elő újra. Ugyanazt a kártya-stílust
// használja, mint a CustomAlert. Az egész ablak tartalma görgethető.
const WelcomeModal = ({
  visible,
  onClose,
  onShown,
  t,
  isDarkMode = false,
  amoledMode = false,
}) => {
  const scaleAnim = useRef(new Animated.Value(0.9)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      scaleAnim.setValue(0.9);
      opacityAnim.setValue(0);
      Animated.parallel([
        Animated.spring(scaleAnim, {
          toValue: 1,
          friction: 8,
          tension: 160,
          useNativeDriver: true,
        }),
        Animated.timing(opacityAnim, {
          toValue: 1,
          duration: 220,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [visible]);

  if (!visible) return null;

  const iconColor = isDarkMode ? '#ffffff' : '#000000';
  const accent = isDarkMode ? '#93c5fd' : '#2563eb';
  const features = [
    { Icon: ScanLine, key: 1 },
    { Icon: ImageIcon, key: 2 },
    { Icon: Palette, key: 3 },
    { Icon: Heart, key: 4 },
    { Icon: RotateCw, key: 5 },
    { Icon: GripVertical, key: 6 },
    { Icon: Link2, key: 7 },
    { Icon: Trash2, key: 8 },
    { Icon: Search, key: 9 },
    { Icon: MapPin, key: 10 },
    { Icon: Sun, key: 11 },
    { Icon: EyeOff, key: 12 },
    { Icon: Fingerprint, key: 13 },
    { Icon: Download, key: 14 },
    { Icon: Share2, key: 15 },
    { Icon: Upload, key: 16 },
    { Icon: Moon, key: 17 },
    { Icon: Languages, key: 18 },
    { Icon: RefreshCw, key: 19 },
  ];

  return (
    <Modal
      transparent
      animationType="fade"
      visible={visible}
      onShow={onShown}
      // Android vissza gomb: szándékosan nem zárja be, csak a "Szuper!" gomb.
      onRequestClose={() => {}}
    >
      <View style={alertStyles.overlay}>
        <Animated.View
          style={[
            alertStyles.alertContainer,
            welcomeStyles.container,
            isDarkMode &&
              (amoledMode
                ? alertStyles.alertContainerAmoled
                : alertStyles.alertContainerDark),
            { opacity: opacityAnim, transform: [{ scale: scaleAnim }] },
          ]}
        >
          <ScrollView
            style={welcomeStyles.scroll}
            contentContainerStyle={welcomeStyles.scrollContent}
            showsVerticalScrollIndicator={false}
            bounces={false}
          >
            <View style={welcomeStyles.iconWrap}>
              <Heart size={44} color="#ef4444" fill="#ef4444" strokeWidth={2.2} />
            </View>
            <View style={welcomeStyles.versionBadge}>
              <Text style={[welcomeStyles.versionBadgeText, { color: accent }]}>
                {t.welcomeVersionPrefix} {WELCOME_VERSION_LABEL}
              </Text>
            </View>
            <Text style={[alertStyles.title, isDarkMode && alertStyles.titleDark]}>
              {t.welcomeTitle}
            </Text>
            <Text
              style={[
                alertStyles.message,
                isDarkMode && alertStyles.messageDark,
                { marginBottom: 14 },
              ]}
            >
              {t.welcomeMessage}
            </Text>

            <Text
              style={[
                welcomeStyles.sectionLabel,
                isDarkMode && welcomeStyles.sectionLabelDark,
              ]}
            >
              {t.welcomeFeaturesTitle}
            </Text>

            <View style={welcomeStyles.list}>
              {features.map(({ Icon, key }) => (
                <View key={key} style={welcomeStyles.row}>
                  <View style={welcomeStyles.rowIcon}>
                    <Icon size={20} color={iconColor} strokeWidth={2.5} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text
                      style={[
                        welcomeStyles.rowTitle,
                        isDarkMode && alertStyles.titleDark,
                      ]}
                    >
                      {t['welcomeF' + key + 'Title']}
                    </Text>
                    <Text
                      style={[
                        welcomeStyles.rowSub,
                        isDarkMode && alertStyles.messageDark,
                      ]}
                    >
                      {t['welcomeF' + key + 'Sub']}
                    </Text>
                  </View>
                </View>
              ))}
            </View>

            <View style={[alertStyles.buttonContainer, { marginTop: 18 }]}>
              <TouchableOpacity
                style={[alertStyles.button, alertStyles.defaultButton]}
                activeOpacity={0.8}
                onPress={onClose}
              >
                <Text style={alertStyles.buttonText}>{t.welcomeCloseBtn}</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
};

const SQUARE_SWITCH_TRAVEL = 24;

// Kockás kapcsoló: koppintásra vált, de a fehér kocka húzható is. A kocka
// állása egyetlen Animated értékből (knobAnim, 0..1) számolódik, így a szín,
// a csúszás és az ikon mindig együtt mozog – húzás közben is.
const SquareSwitch = ({ value, onValueChange }) => {
  const knobAnim = useRef(new Animated.Value(value ? 1 : 0)).current;
  const pressAnim = useRef(new Animated.Value(1)).current;

  // A PanResponder csak egyszer jön létre, ezért a friss értékeket refekből olvassa.
  const valueRef = useRef(value);
  valueRef.current = value;
  const onValueChangeRef = useRef(onValueChange);
  onValueChangeRef.current = onValueChange;
  const knobValueRef = useRef(value ? 1 : 0);
  const dragStartRef = useRef(0);
  const draggingRef = useRef(false);
  const revertTimerRef = useRef(null);

  useEffect(() => {
    const id = knobAnim.addListener(({ value: v }) => {
      knobValueRef.current = v;
    });
    return () => {
      knobAnim.removeListener(id);
      if (revertTimerRef.current) clearTimeout(revertTimerRef.current);
    };
  }, [knobAnim]);

  const animateKnobTo = useCallback(
    (toValue) => {
      Animated.timing(knobAnim, {
        toValue,
        duration: 200,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }).start();
    },
    [knobAnim]
  );

  useEffect(() => {
    animateKnobTo(value ? 1 : 0);
  }, [value, animateKnobTo]);

  const setPressed = useCallback(
    (pressed) => {
      Animated.timing(pressAnim, {
        toValue: pressed ? 0.8 : 1,
        duration: 80,
        useNativeDriver: false,
      }).start();
    },
    [pressAnim]
  );

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => false,
      // Amíg nem húzás zajlik, a görgethető lista elveheti az érintést
      // (függőleges mozdulatnál), húzás közben viszont nálunk marad.
      onPanResponderTerminationRequest: () => !draggingRef.current,
      onPanResponderGrant: () => {
        draggingRef.current = false;
        if (revertTimerRef.current) {
          clearTimeout(revertTimerRef.current);
          revertTimerRef.current = null;
        }
        knobAnim.stopAnimation();
        dragStartRef.current = knobValueRef.current;
        setPressed(true);
      },
      onPanResponderMove: (_, g) => {
        if (!draggingRef.current) {
          if (Math.abs(g.dx) > 4 && Math.abs(g.dx) > Math.abs(g.dy)) {
            draggingRef.current = true;
          } else {
            return;
          }
        }
        const next = Math.min(
          Math.max(dragStartRef.current + g.dx / SQUARE_SWITCH_TRAVEL, 0),
          1
        );
        knobAnim.setValue(next);
      },
      onPanResponderRelease: (_, g) => {
        setPressed(false);
        const wasDragging = draggingRef.current;
        draggingRef.current = false;

        if (!wasDragging) {
          // Koppintás (alig mozdult az ujj) -> átváltás, mint régen.
          if (Math.abs(g.dx) < 6 && Math.abs(g.dy) < 6) {
            onValueChangeRef.current(!valueRef.current);
          }
          return;
        }

        // Elengedéskor a gyors húzás iránya, különben a kocka helye dönt.
        let target = knobValueRef.current >= 0.5 ? 1 : 0;
        if (g.vx > 0.3) target = 1;
        else if (g.vx < -0.3) target = 0;

        animateKnobTo(target);
        const newValue = target === 1;
        if (newValue !== valueRef.current) {
          onValueChangeRef.current(newValue);
          // Ha a szülő nem fogadja el a váltást (pl. megtagadott engedély),
          // a kocka visszaáll a tényleges értékhez.
          revertTimerRef.current = setTimeout(() => {
            revertTimerRef.current = null;
            if (valueRef.current !== newValue) {
              animateKnobTo(valueRef.current ? 1 : 0);
            }
          }, 300);
        }
      },
      onPanResponderTerminate: () => {
        setPressed(false);
        draggingRef.current = false;
        animateKnobTo(valueRef.current ? 1 : 0);
      },
    })
  ).current;

  const knobTranslate = knobAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, SQUARE_SWITCH_TRAVEL],
  });
  const trackColor = knobAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['#ef4444', '#22c55e'],
  });
  const xOpacity = knobAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 0],
  });

  return (
    <Animated.View
      style={{ opacity: pressAnim }}
      accessible
      accessibilityRole="switch"
      accessibilityState={{ checked: !!value }}
      onAccessibilityTap={() => onValueChange(!value)}
      {...panResponder.panHandlers}
    >
      <Animated.View
        style={{
          width: 50,
          height: 26,
          borderRadius: 6,
          padding: 3,
          justifyContent: 'center',
          backgroundColor: trackColor,
        }}
      >
        <Animated.View
          style={{
            width: 20,
            height: 20,
            backgroundColor: '#ffffff',
            borderRadius: 4,
            alignSelf: 'flex-start',
            alignItems: 'center',
            justifyContent: 'center',
            transform: [{ translateX: knobTranslate }],
          }}
        >
          {/* Piros X (kikapcsolva) és zöld pipa (bekapcsolva) – átúsznak egymásba */}
          <Animated.View style={{ position: 'absolute', opacity: xOpacity }}>
            <X size={14} color="#ef4444" strokeWidth={3.5} />
          </Animated.View>
          <Animated.View style={{ position: 'absolute', opacity: knobAnim }}>
            <Check size={14} color="#22c55e" strokeWidth={3.5} />
          </Animated.View>
        </Animated.View>
      </Animated.View>
    </Animated.View>
  );
};

const PHASE_SLIDER_HEIGHT = 26;
const PHASE_SLIDER_PADDING = 3;
const PHASE_SLIDER_THUMB_SIZE = 20;
const PHASE_SLIDER_DOT_SIZE = 6;

// 3 fázisú csúszka, a kapcsológomb (SquareSwitch) kockás designjával:
// négyzetes sín + négyzetes fogantyú. A teljes sáv húzható (nem csak a
// fogantyú), és minden mozgásnál a tényleges érintési pozíciót követi —
// ez megbízhatóan működik ScrollView-n belül is, és a legnagyobb
// fokozatig is simán visszacsúsztatható. Elengedéskor a legközelebbi
// fázisra pattan be.
// 3 fázisú csúszka, a kapcsológomb (SquareSwitch) kockás designjával:
// négyzetes sín + négyzetes fogantyú. Kék a sín háttere, fehér a
// fogantyú. A pozíciót kizárólag a húzás során mért elmozduláshoz
// (gestureState.dx) képest, egy ismert, diszkrét induló pontból (a
// jelenlegi fázis pozíciójából) számoljuk — nincs érintési-pozíció
// alapú újraközpontozás, ami korábban rángást okozott. A teljes sáv
// húzható (nem csak a fogantyú), elengedéskor a legközelebbi fázisra
// pattan be.
const PhaseSlider = ({ value, onValueChange, phaseCount = 3 }) => {
  const [trackWidth, setTrackWidth] = useState(0);
  const thumbX = useRef(new Animated.Value(0)).current;
  const trackWidthRef = useRef(0);
  const lastIndexRef = useRef(value);
  const dragStartXRef = useRef(0);

  const maxTranslate = Math.max(
    trackWidth - PHASE_SLIDER_PADDING * 2 - PHASE_SLIDER_THUMB_SIZE,
    1
  );

  const indexToX = useCallback(
    (index) => (maxTranslate * index) / (phaseCount - 1),
    [maxTranslate, phaseCount]
  );

  useEffect(() => {
    trackWidthRef.current = trackWidth;
  }, [trackWidth]);

  useEffect(() => {
    lastIndexRef.current = value;
  }, [value]);

  useEffect(() => {
    if (trackWidth > 0) {
      Animated.spring(thumbX, {
        toValue: indexToX(value),
        friction: 9,
        tension: 220,
        useNativeDriver: false,
      }).start();
    }
  }, [value, trackWidth, indexToX, thumbX]);

  const getMax = () =>
    Math.max(
      trackWidthRef.current - PHASE_SLIDER_PADDING * 2 - PHASE_SLIDER_THUMB_SIZE,
      1
    );

  const indexToXWithMax = (index, max) => (max * index) / (phaseCount - 1);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponderCapture: (_, gestureState) =>
        Math.abs(gestureState.dx) > Math.abs(gestureState.dy),
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        // Ismert, diszkrét pozícióból indulunk (a jelenlegi fázisból),
        // nem az érintés helyéből — így nincs "ugrás" a húzás elején.
        dragStartXRef.current = indexToXWithMax(lastIndexRef.current, getMax());
      },
      onPanResponderMove: (_, gestureState) => {
        const max = getMax();
        const next = Math.min(
          Math.max(dragStartXRef.current + gestureState.dx, 0),
          max
        );
        thumbX.setValue(next);
      },
      onPanResponderRelease: (evt, gestureState) => {
        const max = getMax();
        // Ha a felhasználó alig mozdította el az ujját, koppintásnak vesszük:
        // ilyenkor a koppintás tényleges helyéhez ugrik a fogantyú, nem a
        // korábbi pozícióhoz képesti elmozduláshoz.
        const isTap =
          Math.abs(gestureState.dx) < 4 && Math.abs(gestureState.dy) < 4;
        const finalX = isTap
          ? Math.min(
              Math.max(
                evt.nativeEvent.locationX -
                  PHASE_SLIDER_PADDING -
                  PHASE_SLIDER_THUMB_SIZE / 2,
                0
              ),
              max
            )
          : Math.min(Math.max(dragStartXRef.current + gestureState.dx, 0), max);
        const rawIndex = max > 0 ? (finalX / max) * (phaseCount - 1) : 0;
        const nearestIndex = Math.min(
          Math.max(Math.round(rawIndex), 0),
          phaseCount - 1
        );

        Animated.spring(thumbX, {
          toValue: indexToXWithMax(nearestIndex, max),
          friction: 9,
          tension: 220,
          useNativeDriver: false,
        }).start();

        if (nearestIndex !== lastIndexRef.current) {
          lastIndexRef.current = nearestIndex;
          onValueChange(nearestIndex);
        }
      },
    })
  ).current;

  return (
    <View
      style={phaseSliderStyles.track}
      onLayout={(e) => setTrackWidth(e.nativeEvent.layout.width)}
      hitSlop={{ top: 12, bottom: 12, left: 4, right: 4 }}
      {...panResponder.panHandlers}
    >
      {trackWidth > 0 &&
        Array.from({ length: phaseCount }).map((_, i) => (
          <View
            key={`phase-mark-${i}`}
            pointerEvents="none"
            style={[
              phaseSliderStyles.marker,
              {
                left:
                  PHASE_SLIDER_PADDING +
                  indexToX(i) +
                  PHASE_SLIDER_THUMB_SIZE / 2 -
                  PHASE_SLIDER_DOT_SIZE / 2,
              },
            ]}
          />
        ))}
      <Animated.View
        style={[
          phaseSliderStyles.thumb,
          { transform: [{ translateX: thumbX }] },
        ]}
      />
    </View>
  );
};

const phaseSliderStyles = StyleSheet.create({
  track: {
    width: '100%',
    height: PHASE_SLIDER_HEIGHT,
    borderRadius: 6,
    padding: PHASE_SLIDER_PADDING,
    justifyContent: 'center',
    backgroundColor: '#2563eb',
  },
  marker: {
    position: 'absolute',
    top: (PHASE_SLIDER_HEIGHT - PHASE_SLIDER_DOT_SIZE) / 2,
    width: PHASE_SLIDER_DOT_SIZE,
    height: PHASE_SLIDER_DOT_SIZE,
    borderRadius: PHASE_SLIDER_DOT_SIZE / 2,
    backgroundColor: '#60a5fa',
  },
  thumb: {
    width: PHASE_SLIDER_THUMB_SIZE,
    height: PHASE_SLIDER_THUMB_SIZE,
    borderRadius: 4,
    backgroundColor: '#ffffff',
    alignSelf: 'flex-start',
  },
});

const hexToRgb = (hex) => {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex || '').trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

const rgbToHex = (r, g, b) =>
  '#' +
  [r, g, b]
    .map((v) =>
      Math.max(0, Math.min(255, Math.round(v)))
        .toString(16)
        .padStart(2, '0')
    )
    .join('')
    .toUpperCase();

// Egyszerű 0–255 csúszka az egyedi színválasztóhoz (R / G / B csatorna),
// a beállítások csúszkájának kockás designjával (négyzetes sín + négyzetes
// fogantyú). A fogantyú útja ugyanúgy a sín belső szélességére van mérve.
const COLOR_SLIDER_HEIGHT = 26;
const COLOR_SLIDER_PADDING = 3;
const COLOR_SLIDER_THUMB = 20;

const ColorChannelSlider = ({ label, value, onChange, tint, isDark }) => {
  const [width, setWidth] = useState(0);
  const widthRef = useRef(0);
  const startValueRef = useRef(0);
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    widthRef.current = width;
  }, [width]);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
  const getTravel = () =>
    Math.max(
      widthRef.current - COLOR_SLIDER_PADDING * 2 - COLOR_SLIDER_THUMB,
      1
    );

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponderCapture: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (evt) => {
        const x =
          evt.nativeEvent.locationX -
          COLOR_SLIDER_PADDING -
          COLOR_SLIDER_THUMB / 2;
        const v = clamp((x / getTravel()) * 255);
        startValueRef.current = v;
        onChangeRef.current(v);
      },
      onPanResponderMove: (_, g) => {
        onChangeRef.current(
          clamp(startValueRef.current + (g.dx / getTravel()) * 255)
        );
      },
    })
  ).current;

  const travel = Math.max(
    width - COLOR_SLIDER_PADDING * 2 - COLOR_SLIDER_THUMB,
    1
  );
  const thumbX = (value / 255) * travel;

  return (
    <View style={colorChannelStyles.row}>
      <Text
        style={[
          colorChannelStyles.label,
          { color: isDark ? '#ffffff' : '#0f172a' },
        ]}
      >
        {label}
      </Text>
      <View
        style={[
          colorChannelStyles.track,
          { backgroundColor: isDark ? '#334155' : '#cbd5e1' },
        ]}
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        hitSlop={{ top: 10, bottom: 10 }}
        {...panResponder.panHandlers}
      >
        {width > 0 && (
          <>
            <View
              pointerEvents="none"
              style={[
                colorChannelStyles.fill,
                { width: thumbX + COLOR_SLIDER_THUMB, backgroundColor: tint },
              ]}
            />
            <View
              pointerEvents="none"
              style={[colorChannelStyles.thumb, { left: COLOR_SLIDER_PADDING + thumbX }]}
            />
          </>
        )}
      </View>
      <Text
        style={[
          colorChannelStyles.value,
          { color: isDark ? '#cbd5e1' : '#475569' },
        ]}
      >
        {Math.round(value)}
      </Text>
    </View>
  );
};

const colorChannelStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', marginTop: 12 },
  label: { width: 18, fontWeight: '700', fontSize: 14 },
  track: {
    flex: 1,
    height: COLOR_SLIDER_HEIGHT,
    borderRadius: 6,
    marginHorizontal: 10,
    justifyContent: 'center',
  },
  fill: {
    position: 'absolute',
    left: COLOR_SLIDER_PADDING,
    top: COLOR_SLIDER_PADDING,
    bottom: COLOR_SLIDER_PADDING,
    borderRadius: 4,
  },
  thumb: {
    position: 'absolute',
    top: COLOR_SLIDER_PADDING,
    width: COLOR_SLIDER_THUMB,
    height: COLOR_SLIDER_THUMB,
    borderRadius: 4,
    backgroundColor: '#ffffff',
  },
  value: { width: 30, textAlign: 'right', fontSize: 13 },
});

const AnimatedDropdownContent = ({ visible, top, style, children }) => {
  const anim = useRef(new Animated.Value(0)).current;
  const [mounted, setMounted] = useState(visible);
  const [menuHeight, setMenuHeight] = useState(0);

  useEffect(() => {
    anim.stopAnimation();
    if (visible) {
      setMounted(true);
      Animated.spring(anim, {
        toValue: 1,
        stiffness: 170,
        damping: 26,
        mass: 1,
        useNativeDriver: true,
      }).start();
    } else {
      Animated.timing(anim, {
        toValue: 0,
        duration: 180,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) setMounted(false);
      });
    }
  }, [visible]);

  if (!mounted) return null;

  const START_SCALE = 0.85;

  return (
    <Animated.View
      pointerEvents={visible ? 'auto' : 'none'}
      onLayout={(e) => setMenuHeight(e.nativeEvent.layout.height)}
      style={[
        style,
        {
          position: 'absolute',
          top,
          left: 0,
          right: 0,
          zIndex: 20,
          opacity: anim.interpolate({
            inputRange: [0, 0.6],
            outputRange: [0, 1],
            extrapolate: 'clamp',
          }),
          transform: [
            {
              // a menü teteje az animáció alatt is a sornál marad
              translateY: anim.interpolate({
                inputRange: [0, 1],
                outputRange: [-(menuHeight * (1 - START_SCALE)) / 2, 0],
              }),
            },
            {
              scaleY: anim.interpolate({
                inputRange: [0, 1],
                outputRange: [START_SCALE, 1],
              }),
            },
          ],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
};

const translations = {
  en: {
    title: 'QuickWallet',
    active: 'ACTIVE',
    settings: 'Settings',
    language: 'Language',
    appearance: 'Appearance',
    theme: 'Theme',
    themeSystem: 'System default',
    themeLight: 'Light mode',
    themeDark: 'Dark mode',
    themeOptSystem: 'System',
    themeOptLight: 'Light',
    themeOptDark: 'Dark',
    amoled: 'Pure black (AMOLED)',
    amoledSub: 'Deep black background for better battery life',
    advanced: 'Advanced Features',
    swipeDelete: 'Swipe to delete cards',
    swipeDeleteSub: 'Swiping a card to the left reveals the delete button',
    swipeLink: 'Swipe to link app',
    swipeLinkSub: 'Swiping a card to the right reveals the app link button',
    hideCodes: 'Hide card codes',
    hideCodesSub: 'Codes are only visible for the card you open',
    nearbyCard: 'Show nearby store card first',
    nearbyCardSub: 'Near a store, the card with the same name jumps to the top. Needs internet and precise location access. Your position, as precise as the permission you grant, is looked up on OpenStreetMap; no card data is sent. Without internet nothing happens',
    locationPermissionDenied: 'This feature needs location permission. Please allow it in your phone settings.',
    brightnessBoost: 'Increase brightness for active card',
    brightnessBoostSub: 'Automatically raises screen brightness when a card is opened, for easier scanning',
    brightnessBoostLevelLabel: 'Boost amount',
    brightnessLevelLow: 'Mild',
    brightnessLevelMedium: 'Medium',
    brightnessLevelHigh: 'Maximum',
    backupSection: 'Backup & Restore',
    backupDownload: 'Download',
    backupDownloadSub: 'Save the file directly to your device storage (e.g. Downloads)',
    backupExport: 'Share',
    backupExportSub: 'Send your data to another device via QR code or as a file',
    backupImport: 'Restore from file',
    backupImportSub: 'Load a previously saved backup file',
    backupExportSuccess: 'Backup created successfully.',
    backupExportError: 'Failed to create the backup.',
    backupImportTitle: 'Restore data',
    backupImportConfirm: 'Restoring overwrites your current cards and settings with the data in the file.',
    backupImportSuccess: 'Data restored successfully.',
    backupImportError: 'Failed to restore the file — it may be corrupted or in the wrong format.',
    backupRestoreBtn: 'Restore',
    backupQrTitle: 'Share via QR code',
    backupQrSubtitle: 'Scan this code in QuickWallet on the other device and your data will transfer automatically.',
    backupShareOtherBtn: 'Share another way',
    backupScanInstruction: 'Point the camera at the QR code shown on the other device.',
    backupQrInvalidScan: 'This is not a valid backup QR code. Please try again.',
    shareReceiveTitle: 'Cards received',
    shareReceiveMessage: 'You received {count} card(s). Do you want to add them to your current cards or replace your current cards with them?',
    shareAddBtn: 'Add',
    shareReplaceBtn: 'Replace',
    shareAddedSuccess: '{count} card(s) added.',
    shareReplacedSuccess: 'Your cards have been replaced with {count} received card(s).',
    shareNoNewCards: 'These cards are already in your wallet.',
    shareInvalid: 'No valid cards found in the shared data.',
    shareFileName: 'quickwallet_cards',
    lockScreenUnlockBtn: 'Unlock',
    authPromptMessage: 'Authenticate to open QuickWallet',
    authCancel: 'Cancel',
    updateSection: 'Updates',
    autoUpdateCheck: 'Check automatically on startup',
    autoUpdateCheckSub: 'Silently checks for a new version when the app starts',
    checkUpdateNow: 'Check now',
    currentVersionLabel: 'Current version:',
    updateRepoNotConfigured: 'Update checking is not configured yet.',
    updateAvailableTitle: 'Update available',
    updateAvailableMessage: 'Version {version} is available. Open the download page?',
    updateInstallBtn: 'Open',
    updateUpToDate: "You're using the latest version.",
    updateCheckError: 'Failed to check for updates.',
    updateDownloadError: 'Failed to open the download page.',
    welcomeVersionPrefix: 'Version',
    welcomeTitle: 'Thank you for using QuickWallet!',
    welcomeMessage: 'This is the first official release. Thanks for being here from the start.',
    welcomeFeaturesTitle: 'Everything in 1.0',
    welcomeF1Title: 'Scan with the camera',
    welcomeF1Sub: 'Barcodes and QR codes: QR, EAN, Code 128, Code 39, UPC, PDF417 and Aztec.',
    welcomeF2Title: 'Import from a screenshot',
    welcomeF2Sub: 'Pick an image from your gallery and the code is read from it.',
    welcomeF3Title: 'Colors and editing',
    welcomeF3Sub: 'Choose a card color or your own custom one, and rename the card any time.',
    welcomeF4Title: 'Favorites',
    welcomeF4Sub: 'Tap the heart on a card and favorites always stay at the top of the list.',
    welcomeF5Title: 'Card back',
    welcomeF5Sub: 'Long-press a card to flip it and get the Edit, Link App and Delete buttons.',
    welcomeF6Title: 'Reorder cards',
    welcomeF6Sub: 'With the card back open, drag the handle to put your cards in any order.',
    welcomeF7Title: 'Link the store\'s app',
    welcomeF7Sub: 'Swipe a card right to link the store\'s own app, then open it with one tap.',
    welcomeF8Title: 'Swipe to delete',
    welcomeF8Sub: 'Swipe a card left to reveal the delete button (can be turned off).',
    welcomeF9Title: 'Search',
    welcomeF9Sub: 'Find any card in a moment by the store\'s name.',
    welcomeF10Title: 'Nearby store first',
    welcomeF10Sub: 'Next to a store, its card jumps to the top of the list (optional).',
    welcomeF11Title: 'Brighter screen',
    welcomeF11Sub: 'The screen gets brighter when you open a card, in three levels to choose from.',
    welcomeF12Title: 'Hide card codes',
    welcomeF12Sub: 'Codes are only visible for the card you open.',
    welcomeF13Title: 'App lock',
    welcomeF13Sub: 'Protect your wallet with your fingerprint or device lock.',
    welcomeF14Title: 'Save to a file',
    welcomeF14Sub: 'Download a backup of your cards and settings straight to your device.',
    welcomeF15Title: 'Share with QR code or file',
    welcomeF15Sub: 'Move everything to another device. Received cards can be added or can replace your current ones.',
    welcomeF16Title: 'Restore from a backup',
    welcomeF16Sub: 'Load a previously saved file to get your cards and settings back.',
    welcomeF17Title: 'Light, dark and AMOLED',
    welcomeF17Sub: 'Follows the system or set it yourself, with a pure black mode for OLED screens.',
    welcomeF18Title: 'Three languages',
    welcomeF18Sub: 'English, Hungarian and German, switchable any time.',
    welcomeF19Title: 'Update check',
    welcomeF19Sub: 'Checks silently on startup, or press Check now in the settings.',
    welcomeCloseBtn: 'Awesome!',
    welcomeShowAgain: 'What\'s new in 1.0?',
    developer: 'Developer',
    developedBy: 'Developed by:',
    newCard: 'New Card',
    editCard: 'Edit Card',
    storeName: 'Store Name',
    storePlaceholder: 'e.g. Lidl, Tesco, SPAR',
    addCode: 'Add Code',
    scan: 'Scan',
    scanSub: 'With camera',
    screenshot: 'Screenshot',
    screenshotSub: 'From image',
    codeSaved: 'Code saved:',
    cardColor: 'Card Color',
    customColor: 'Custom color',
    cancel: 'Cancel',
    save: 'Save',
    editBtn: 'Edit',
    linkBtn: 'Link App',
    emptyTitle: 'No cards added yet.',
    emptySub: 'Add a loyalty card using the + button.',
    deleteTitle: 'Delete Card',
    deleteConfirm: 'Are you sure you want to delete "{name}"?',
    deleteBtn: 'Delete',
    alertWarning: 'Warning',
    alertNameReq: 'Please enter the store name!',
    alertCodeReq: 'Please scan a code before saving!',
    alertCodeExists: 'A card with this code already exists:',
    camPermissionDenied: 'Camera permission denied.',
    scanInstruction: 'Point the camera at the barcode or QR code',
    barcodePreview: 'Barcode preview',
    detectedFormatLabel: 'Detected format:',
    selectAppTitle: 'Select Application',
    noAppLinked: 'No app linked',
    searchAppPlaceholder: 'Search apps...',
    loadingApps: 'Loading apps...',
    galleryPermissionDenied: 'Gallery permission denied.',
    noCodeInImage: 'No barcode found in the selected image.',
    searchCardsPlaceholder: 'Search your cards...',
    searchNoResults: 'No card matches that name.',
  },
  hu: {
    title: 'QuickWallet',
    active: 'AKTÍV',
    settings: 'Beállítások',
    language: 'Nyelv',
    appearance: 'Megjelenés',
    theme: 'Téma',
    themeSystem: 'Rendszer alapértelmezett',
    themeLight: 'Világos mód',
    themeDark: 'Sötét mód',
    themeOptSystem: 'Rendszer',
    themeOptLight: 'Világos',
    themeOptDark: 'Sötét',
    amoled: 'Tiszta fekete (AMOLED)',
    amoledSub: 'Mélyfekete háttér a jobb akkumulátor-üzemidőért',
    advanced: 'Speciális Funkciók',
    swipeDelete: 'Kártyák törlése húzással',
    swipeDeleteSub: 'A kártya balra csúsztatásával megjelenik a törlés gomb',
    swipeLink: 'App társítása húzással',
    swipeLinkSub: 'A kártya jobbra csúsztatásával megjelenik az app társítása gomb',
    hideCodes: 'Kártyakódok elrejtése',
    hideCodesSub: 'A kód csak annál a kártyánál látszik, amelyet megnyitsz',
    nearbyCard: 'Közeli bolt kártyája legyen felül',
    nearbyCardSub: 'Bolt közelében az azonos nevű kártya felkerül a lista tetejére. Internet és pontos helyhozzáférés kell hozzá.',
    locationPermissionDenied: 'A funkcióhoz engedélyezned kell a helyhozzáférést a telefon beállításaiban.',
    brightnessBoost: 'Fényerő növelése aktív kártyánál',
    brightnessBoostSub: 'Kártya megnyitásakor automatikusan felmegy a képernyő fényereje a jobb beolvashatóságért',
    brightnessBoostLevelLabel: 'Növelés mértéke',
    brightnessLevelLow: 'Enyhe',
    brightnessLevelMedium: 'Közepes',
    brightnessLevelHigh: 'Maximális',
    backupSection: 'Biztonsági mentés',
    backupDownload: 'Letöltés',
    backupDownloadSub: 'Fájl mentése közvetlenül a telefon tárhelyére (pl. Letöltések)',
    backupExport: 'Megosztás',
    backupExportSub: 'QR kóddal vagy fájlként küldheted át az adataidat egy másik eszközre',
    backupImport: 'Visszaállítás fájlból',
    backupImportSub: 'Korábban mentett biztonsági fájl betöltése',
    backupExportSuccess: 'A biztonsági mentés elkészült.',
    backupExportError: 'Nem sikerült elkészíteni a biztonsági mentést.',
    backupImportTitle: 'Adatok visszaállítása',
    backupImportConfirm: 'A visszaállítás felülírja a jelenlegi kártyáidat és beállításaidat a fájlban lévő adatokkal.',
    backupImportSuccess: 'Az adatok visszaállítása sikerült.',
    backupImportError: 'Nem sikerült visszaállítani a fájlt — lehet, hogy sérült vagy nem megfelelő formátumú.',
    backupRestoreBtn: 'Visszaállítás',
    backupQrTitle: 'Megosztás QR kóddal',
    backupQrSubtitle: 'Olvasd be ezt a kódot a másik eszközön a QuickWallet alkalmazásban, és az adataid automatikusan átkerülnek.',
    backupShareOtherBtn: 'Megosztás máshogy',
    backupScanInstruction: 'Irányítsd a kamerát a másik eszközön megjelenő QR kódra.',
    backupQrInvalidScan: 'Ez nem érvényes biztonsági mentés QR kód. Próbáld újra.',
    shareReceiveTitle: 'Kártyák érkeztek',
    shareReceiveMessage: '{count} kártyát kaptál. Hozzáadod őket a jelenlegi kártyáidhoz, vagy lecseréled velük a jelenlegi kártyáidat?',
    shareAddBtn: 'Hozzáadás',
    shareReplaceBtn: 'Csere',
    shareAddedSuccess: '{count} kártya hozzáadva.',
    shareReplacedSuccess: 'A kártyáidat lecseréltük a kapott {count} kártyára.',
    shareNoNewCards: 'Ezek a kártyák már megvannak a tárcádban.',
    shareInvalid: 'A megosztott adatok nem tartalmaznak érvényes kártyát.',
    shareFileName: 'quickwallet_kartyak',
    lockScreenUnlockBtn: 'Feloldás',
    authPromptMessage: 'Azonosítsd magad a QuickWallet megnyitásához',
    authCancel: 'Mégse',
    updateSection: 'Frissítések',
    autoUpdateCheck: 'Automatikus ellenőrzés indításkor',
    autoUpdateCheckSub: 'Az app indulásakor csendben megnézi, van-e új verzió',
    checkUpdateNow: 'Ellenőrzés most',
    currentVersionLabel: 'Jelenlegi verzió:',
    updateRepoNotConfigured: 'A frissítés-ellenőrzés még nincs beállítva.',
    updateAvailableTitle: 'Új verzió elérhető',
    updateAvailableMessage: 'Elérhető a(z) {version} verzió. Megnyitod a letöltési oldalt?',
    updateInstallBtn: 'Megnyitás',
    updateUpToDate: 'A legfrissebb verziót használod.',
    updateCheckError: 'Nem sikerült ellenőrizni a frissítéseket.',
    updateDownloadError: 'Nem sikerült megnyitni a letöltési oldalt.',
    welcomeVersionPrefix: 'Verzió',
    welcomeTitle: 'Köszönjük, hogy a QuickWalletet használod!',
    welcomeMessage: 'Ez az első hivatalos kiadás. Köszönjük, hogy az elejétől velünk vagy.',
    welcomeFeaturesTitle: 'Minden, ami az 1.0-ban van',
    welcomeF1Title: 'Beolvasás kamerával',
    welcomeF1Sub: 'Vonalkódok és QR kódok: QR, EAN, Code 128, Code 39, UPC, PDF417 és Aztec.',
    welcomeF2Title: 'Képernyőképből',
    welcomeF2Sub: 'Válassz képet a galériából, és az app kiolvassa belőle a kódot.',
    welcomeF3Title: 'Színek és szerkesztés',
    welcomeF3Sub: 'Válassz kártyaszínt vagy saját egyedi színt, a kártya nevét bármikor átírhatod.',
    welcomeF4Title: 'Kedvencek',
    welcomeF4Sub: 'Koppints a kártyán a szívre, és a kedvencek mindig a lista elején maradnak.',
    welcomeF5Title: 'Kártya hátoldala',
    welcomeF5Sub: 'Hosszan nyomva a kártyát megfordul, és megjelenik a Szerkesztés, az App társítása és a Törlés gomb.',
    welcomeF6Title: 'Kártyák átrendezése',
    welcomeF6Sub: 'Megnyitott hátoldalnál a fogantyút húzva tetszőleges sorrendbe rakhatod a kártyáidat.',
    welcomeF7Title: 'A bolt appjának társítása',
    welcomeF7Sub: 'Jobbra húzva a kártyát társíthatod a bolt saját appját, és egy koppintással megnyithatod.',
    welcomeF8Title: 'Törlés húzással',
    welcomeF8Sub: 'Balra húzva a kártyát előbukkan a törlés gomb (kikapcsolható).',
    welcomeF9Title: 'Keresés',
    welcomeF9Sub: 'Bármelyik kártyát megtalálod egy pillanat alatt a bolt neve alapján.',
    welcomeF10Title: 'Közeli bolt előre',
    welcomeF10Sub: 'Bolt közelében a hozzá tartozó kártya a lista elejére ugrik (opcionális).',
    welcomeF11Title: 'Fényesebb kijelző',
    welcomeF11Sub: 'Kártya megnyitásakor a kijelző fényereje megnő, három szint közül választhatsz.',
    welcomeF12Title: 'Kódok elrejtése',
    welcomeF12Sub: 'A kódok csak a megnyitott kártyánál látszanak.',
    welcomeF13Title: 'Alkalmazászár',
    welcomeF13Sub: 'Védd a tárcádat ujjlenyomattal vagy az eszköz zárolásával.',
    welcomeF14Title: 'Mentés fájlba',
    welcomeF14Sub: 'Töltsd le a kártyáid és beállításaid biztonsági mentését közvetlenül az eszközödre.',
    welcomeF15Title: 'Megosztás QR kóddal vagy fájlként',
    welcomeF15Sub: 'Vigyél át mindent másik eszközre. A kapott kártyákat hozzáadhatod, vagy lecserélheted velük a jelenlegieket.',
    welcomeF16Title: 'Visszaállítás mentésből',
    welcomeF16Sub: 'Töltsd be a korábban mentett fájlt, és visszakapod a kártyáidat és a beállításaidat.',
    welcomeF17Title: 'Világos, sötét és AMOLED',
    welcomeF17Sub: 'Követi a rendszert, vagy te állítod be, OLED kijelzőkhöz tiszta fekete móddal.',
    welcomeF18Title: 'Három nyelv',
    welcomeF18Sub: 'Magyar, angol és német, bármikor átváltható.',
    welcomeF19Title: 'Frissítés-ellenőrzés',
    welcomeF19Sub: 'Indításkor csendben megnézi, vagy nyomd meg a beállításokban az Ellenőrzés most gombot.',
    welcomeCloseBtn: 'Szuper!',
    welcomeShowAgain: 'Mi újság az 1.0-ban?',
    developer: 'Fejlesztő',
    developedBy: 'Fejlesztette:',
    newCard: 'Új kártya',
    editCard: 'Kártya szerkesztése',
    storeName: 'Bolt neve',
    storePlaceholder: 'Pl. Lidl, Tesco, SPAR',
    addCode: 'Kód hozzáadása',
    scan: 'Szkennelés',
    scanSub: 'Kamerával',
    screenshot: 'Képernyőkép',
    screenshotSub: 'Képből',
    codeSaved: 'Kód rögzítve:',
    cardColor: 'Kártya színe',
    customColor: 'Egyedi szín',
    cancel: 'Mégse',
    save: 'Mentés',
    editBtn: 'Szerkesztés',
    linkBtn: 'App társítása',
    emptyTitle: 'Még nincsenek kártyáid.',
    emptySub: 'Adj hozzá egy hűségkártyát a + gombbal.',
    deleteTitle: 'Kártya törlése',
    deleteConfirm: 'Biztosan törlöd a(z) "{name}" kártyát?',
    deleteBtn: 'Törlés',
    alertWarning: 'Figyelem',
    alertNameReq: 'Add meg a bolt nevét!',
    alertCodeReq: 'Olvass be egy kódot mentés előtt!',
    alertCodeExists: 'Már van ilyen kódú kártya:',
    camPermissionDenied: 'A kamerához való hozzáférés meg lett tagadva.',
    scanInstruction: 'Irányítsd a kamerát a vonalkódra vagy QR-kódra',
    barcodePreview: 'Vonalkód előnézet',
    detectedFormatLabel: 'Felismert formátum:',
    selectAppTitle: 'Alkalmazás kiválasztása',
    noAppLinked: 'Nincs társítva semmi',
    searchAppPlaceholder: 'Keresés az alkalmazások között...',
    loadingApps: 'Alkalmazások betöltése...',
    galleryPermissionDenied: 'A galériához való hozzáférés meg lett tagadva.',
    noCodeInImage: 'Nem található vonalkód a kiválasztott képen.',
    searchCardsPlaceholder: 'Keresés a kártyák között...',
    searchNoResults: 'Nincs ilyen nevű kártyád.',
  },
  de: {
    title: 'QuickWallet',
    active: 'AKTIV',
    settings: 'Einstellungen',
    language: 'Sprache',
    appearance: 'Darstellung',
    theme: 'Design',
    themeSystem: 'Systemstandard',
    themeLight: 'Heller Modus',
    themeDark: 'Dunkler Modus',
    themeOptSystem: 'System',
    themeOptLight: 'Hell',
    themeOptDark: 'Dunkel',
    amoled: 'Reines Schwarz (AMOLED)',
    amoledSub: 'Tiefschwarzer Hintergrund für eine längere Akkulaufzeit',
    advanced: 'Erweiterte Funktionen',
    swipeDelete: 'Wischen zum Löschen von Karten',
    swipeDeleteSub: 'Beim Wischen einer Karte nach links erscheint die Löschen-Schaltfläche',
    swipeLink: 'Wischen zum Verknüpfen einer App',
    swipeLinkSub: 'Beim Wischen einer Karte nach rechts erscheint die Schaltfläche zum Verknüpfen einer App',
    hideCodes: 'Kartencodes ausblenden',
    hideCodesSub: 'Codes sind nur bei der Karte sichtbar, die du öffnest',
    nearbyCard: 'Karte des nahen Geschäfts oben',
    nearbyCardSub: 'In der Nähe eines Geschäfts springt die Karte mit demselben Namen nach oben. Internet und genauer Standortzugriff nötig. Deine Position (so genau, wie du es erlaubst) wird bei OpenStreetMap abgefragt, Kartendaten werden nicht gesendet. Ohne Internet passiert nichts',
    locationPermissionDenied: 'Für diese Funktion ist die Standortberechtigung nötig. Bitte erlaube sie in den Einstellungen.',
    brightnessBoost: 'Helligkeit bei aktiver Karte erhöhen',
    brightnessBoostSub: 'Erhöht beim Öffnen einer Karte automatisch die Bildschirmhelligkeit für besseres Scannen',
    brightnessBoostLevelLabel: 'Stärke der Erhöhung',
    brightnessLevelLow: 'Leicht',
    brightnessLevelMedium: 'Mittel',
    brightnessLevelHigh: 'Maximal',
    backupSection: 'Sicherung und Wiederherstellung',
    backupDownload: 'Herunterladen',
    backupDownloadSub: 'Speichert die Datei direkt im Gerätespeicher (z. B. Downloads)',
    backupExport: 'Teilen',
    backupExportSub: 'Sende deine Daten per QR-Code oder als Datei an ein anderes Gerät',
    backupImport: 'Aus Datei wiederherstellen',
    backupImportSub: 'Lädt eine zuvor gespeicherte Sicherungsdatei',
    backupExportSuccess: 'Sicherung erfolgreich erstellt.',
    backupExportError: 'Die Sicherung konnte nicht erstellt werden.',
    backupImportTitle: 'Daten wiederherstellen',
    backupImportConfirm: 'Wiederherstellen überschreibt deine aktuellen Karten und Einstellungen mit den Daten aus der Datei.',
    backupImportSuccess: 'Daten erfolgreich wiederhergestellt.',
    backupImportError: 'Die Datei konnte nicht wiederhergestellt werden – sie ist möglicherweise beschädigt oder hat ein falsches Format.',
    backupRestoreBtn: 'Wiederherstellen',
    backupQrTitle: 'Per QR-Code teilen',
    backupQrSubtitle: 'Scanne diesen Code in QuickWallet auf dem anderen Gerät, und deine Daten werden automatisch übertragen.',
    backupShareOtherBtn: 'Anders teilen',
    backupScanInstruction: 'Richte die Kamera auf den QR-Code, der auf dem anderen Gerät angezeigt wird.',
    backupQrInvalidScan: 'Das ist kein gültiger Sicherungs-QR-Code. Bitte versuche es erneut.',
    shareReceiveTitle: 'Karten erhalten',
    shareReceiveMessage: 'Du hast {count} Karte(n) erhalten. Möchtest du sie zu deinen aktuellen Karten hinzufügen oder deine aktuellen Karten damit ersetzen?',
    shareAddBtn: 'Hinzufügen',
    shareReplaceBtn: 'Ersetzen',
    shareAddedSuccess: '{count} Karte(n) hinzugefügt.',
    shareReplacedSuccess: 'Deine Karten wurden durch {count} erhaltene Karte(n) ersetzt.',
    shareNoNewCards: 'Diese Karten sind bereits in deiner Wallet.',
    shareInvalid: 'Die geteilten Daten enthalten keine gültigen Karten.',
    shareFileName: 'quickwallet_karten',
    lockScreenUnlockBtn: 'Entsperren',
    authPromptMessage: 'Authentifiziere dich, um QuickWallet zu öffnen',
    authCancel: 'Abbrechen',
    updateSection: 'Updates',
    autoUpdateCheck: 'Beim Start automatisch prüfen',
    autoUpdateCheckSub: 'Prüft beim Start der App unauffällig, ob eine neue Version verfügbar ist',
    checkUpdateNow: 'Jetzt prüfen',
    currentVersionLabel: 'Aktuelle Version:',
    updateRepoNotConfigured: 'Die Update-Prüfung ist noch nicht eingerichtet.',
    updateAvailableTitle: 'Update verfügbar',
    updateAvailableMessage: 'Version {version} ist verfügbar. Downloadseite öffnen?',
    updateInstallBtn: 'Öffnen',
    updateUpToDate: 'Du verwendest die neueste Version.',
    updateCheckError: 'Die Suche nach Updates ist fehlgeschlagen.',
    updateDownloadError: 'Die Downloadseite konnte nicht geöffnet werden.',
    welcomeVersionPrefix: 'Version',
    welcomeTitle: 'Danke, dass du QuickWallet nutzt!',
    welcomeMessage: 'Das ist die erste offizielle Version. Danke, dass du von Anfang an dabei bist.',
    welcomeFeaturesTitle: 'Alles in 1.0',
    welcomeF1Title: 'Mit der Kamera scannen',
    welcomeF1Sub: 'Barcodes und QR-Codes: QR, EAN, Code 128, Code 39, UPC, PDF417 und Aztec.',
    welcomeF2Title: 'Aus einem Screenshot',
    welcomeF2Sub: 'Wähle ein Bild aus der Galerie, und der Code wird daraus gelesen.',
    welcomeF3Title: 'Farben und Bearbeiten',
    welcomeF3Sub: 'Wähle eine Kartenfarbe oder eine eigene Farbe, und benenne die Karte jederzeit um.',
    welcomeF4Title: 'Favoriten',
    welcomeF4Sub: 'Tippe auf das Herz einer Karte, und Favoriten bleiben immer oben in der Liste.',
    welcomeF5Title: 'Kartenrückseite',
    welcomeF5Sub: 'Karte lange drücken, um sie zu wenden und Bearbeiten, App verknüpfen und Löschen zu erhalten.',
    welcomeF6Title: 'Karten neu anordnen',
    welcomeF6Sub: 'Bei geöffneter Rückseite den Griff ziehen, um die Karten in beliebige Reihenfolge zu bringen.',
    welcomeF7Title: 'App des Geschäfts verknüpfen',
    welcomeF7Sub: 'Karte nach rechts wischen, um die App des Geschäfts zu verknüpfen und mit einem Tipp zu öffnen.',
    welcomeF8Title: 'Wischen zum Löschen',
    welcomeF8Sub: 'Karte nach links wischen, um den Löschen-Button zu zeigen (abschaltbar).',
    welcomeF9Title: 'Suche',
    welcomeF9Sub: 'Finde jede Karte schnell über den Namen des Geschäfts.',
    welcomeF10Title: 'Nahe Geschäfte zuerst',
    welcomeF10Sub: 'In der Nähe eines Geschäfts springt die passende Karte an den Anfang (optional).',
    welcomeF11Title: 'Hellerer Bildschirm',
    welcomeF11Sub: 'Beim Öffnen einer Karte steigt die Helligkeit, in drei wählbaren Stufen.',
    welcomeF12Title: 'Kartencodes verbergen',
    welcomeF12Sub: 'Codes sind nur bei der geöffneten Karte sichtbar.',
    welcomeF13Title: 'App-Sperre',
    welcomeF13Sub: 'Schütze deine Wallet mit Fingerabdruck oder Gerätesperre.',
    welcomeF14Title: 'In Datei sichern',
    welcomeF14Sub: 'Lade eine Sicherung deiner Karten und Einstellungen direkt auf dein Gerät.',
    welcomeF15Title: 'Teilen per QR-Code oder Datei',
    welcomeF15Sub: 'Übertrage alles auf ein anderes Gerät. Erhaltene Karten können hinzugefügt werden oder deine aktuellen ersetzen.',
    welcomeF16Title: 'Aus Sicherung wiederherstellen',
    welcomeF16Sub: 'Lade eine zuvor gespeicherte Datei, um Karten und Einstellungen zurückzubekommen.',
    welcomeF17Title: 'Hell, dunkel und AMOLED',
    welcomeF17Sub: 'Folgt dem System oder wird selbst gewählt, mit rein schwarzem Modus für OLED-Displays.',
    welcomeF18Title: 'Drei Sprachen',
    welcomeF18Sub: 'Deutsch, Englisch und Ungarisch, jederzeit umschaltbar.',
    welcomeF19Title: 'Update-Prüfung',
    welcomeF19Sub: 'Prüft beim Start im Hintergrund, oder tippe in den Einstellungen auf Jetzt prüfen.',
    welcomeCloseBtn: 'Super!',
    welcomeShowAgain: 'Was ist neu in 1.0?',
    developer: 'Entwickler',
    developedBy: 'Entwickelt von:',
    newCard: 'Neue Karte',
    editCard: 'Karte bearbeiten',
    storeName: 'Name des Geschäfts',
    storePlaceholder: 'z. B. Lidl, Tesco, SPAR',
    addCode: 'Code hinzufügen',
    scan: 'Scannen',
    scanSub: 'Mit der Kamera',
    screenshot: 'Screenshot',
    screenshotSub: 'Aus Bild',
    codeSaved: 'Code gespeichert:',
    cardColor: 'Kartenfarbe',
    customColor: 'Eigene Farbe',
    cancel: 'Abbrechen',
    save: 'Speichern',
    editBtn: 'Bearbeiten',
    linkBtn: 'App verknüpfen',
    emptyTitle: 'Noch keine Karten vorhanden.',
    emptySub: 'Füge mit der +-Taste eine Kundenkarte hinzu.',
    deleteTitle: 'Karte löschen',
    deleteConfirm: 'Möchtest du die Karte „{name}“ wirklich löschen?',
    deleteBtn: 'Löschen',
    alertWarning: 'Achtung',
    alertNameReq: 'Bitte gib den Namen des Geschäfts ein!',
    alertCodeReq: 'Bitte scanne vor dem Speichern einen Code!',
    alertCodeExists: 'Eine Karte mit diesem Code existiert bereits:',
    camPermissionDenied: 'Der Kamerazugriff wurde verweigert.',
    scanInstruction: 'Richte die Kamera auf den Barcode oder QR-Code',
    barcodePreview: 'Barcode-Vorschau',
    detectedFormatLabel: 'Erkanntes Format:',
    selectAppTitle: 'App auswählen',
    noAppLinked: 'Keine App verknüpft',
    searchAppPlaceholder: 'Apps durchsuchen...',
    loadingApps: 'Apps werden geladen...',
    galleryPermissionDenied: 'Der Zugriff auf die Galerie wurde verweigert.',
    noCodeInImage: 'Im ausgewählten Bild wurde kein Barcode gefunden.',
    searchCardsPlaceholder: 'Karten durchsuchen...',
    searchNoResults: 'Keine Karte mit diesem Namen gefunden.',
  },
};

const languagesList = [
  { id: 'en', label: 'English' },
  { id: 'hu', label: 'Magyar' },
  { id: 'de', label: 'Deutsch' },
];

// A statikus képes felismerés (scanFromURLAsync) néhány eszközön a
// Google ML Kit nyers, numerikus formátumkonstansait adja vissza
// szöveg helyett (pl. 256 = QR-kód). Ezeket normalizáljuk.
const ML_KIT_BARCODE_FORMAT_MAP = {
  1: 'code128',
  2: 'code39',
  4: 'code93',
  8: 'codabar',
  16: 'data_matrix',
  32: 'ean13',
  64: 'ean8',
  128: 'itf',
  256: 'qr',
  512: 'upc_a',
  1024: 'upc_e',
  2048: 'pdf417',
  4096: 'aztec',
};

const normalizeBarcodeType = (type) => {
  if (typeof type === 'number') {
    return ML_KIT_BARCODE_FORMAT_MAP[type] || String(type);
  }
  return type;
};

const mapBarcodeFormat = (rawType, value) => {
  const type = normalizeBarcodeType(rawType);
  const lower = type ? String(type).toLowerCase() : '';
  if (lower.includes('ean13') || lower.includes('ean-13')) return 'EAN13';
  if (lower.includes('ean8') || lower.includes('ean-8')) return 'EAN8';
  if (lower.includes('code39')) return 'CODE39';
  if (lower.includes('code128')) return 'CODE128';
  if (lower.includes('upc_e') || lower.includes('upce') || lower.includes('upc-e')) return 'UPCE';
  if (lower.includes('upc_a') || lower.includes('upca') || lower.includes('upc-a')) return 'UPC';
  if (lower.includes('qr') || lower.includes('pdf417') || lower.includes('aztec')) {
    return null;
  }

  if (value) {
    const digitsOnly = String(value).trim();
    if (/^\d+$/.test(digitsOnly)) {
      if (digitsOnly.length === 13) return 'EAN13';
      if (digitsOnly.length === 8) return 'EAN8';
      if (digitsOnly.length === 12) return 'UPC';
      if (digitsOnly.length === 6 || digitsOnly.length === 7) return 'UPCE';
    }
  }

  return 'CODE128';
};

const isQrCodeType = (rawType) => {
  const type = normalizeBarcodeType(rawType);
  if (!type) return false;
  return String(type).toLowerCase().includes('qr');
};

const BARCODE_SCAN_TYPES = [
  'qr',
  'ean13',
  'ean8',
  'code128',
  'code39',
  'upc_a',
  'upc_e',
  'pdf417',
  'aztec',
];

const AnimatedCardItem = React.memo(function AnimatedCardItem({
  card,
  index,
  collapsedY,
  hasActiveCard,
  hideCodes,
  activeCardId,
  isExpanded,
  setIsExpanded,
  flippedCardId,
  setFlippedCardId,
  swipeToDeleteEnabled,
  swipeToLinkEnabled,
  swipedCardId,
  setSwipedCardId,
  onSelect,
  onDelete,
  isDeleting,
  isNewlyAdded,
  onDeleteAnimationEnd,
  onOpenAppSelector,
  onOpenLinkedApp,
  onEditCard,
  onScrollToCard,
  onToggleFavorite,
  isReorderMode,
  reorderReferenceIndex,
  dragCardId,
  dragOriginIndex,
  dragHoverIndex,
  onDragStart,
  onDragMove,
  onDragEnd,
  t,
}) {
  const cardIsActive = card.id === activeCardId;
  const cardIsFlipped = card.id === flippedCardId;
  // A kód el van rejtve, ha másik kártya aktív, vagy ha a szem-ikonnal
  // elrejtettük a kódokat – ilyenkor csak az aktivált kártya kódja látszik.
  const isPixelated = (hasActiveCard || hideCodes) && !cardIsActive;

  const panX = useRef(new Animated.Value(0)).current;
  const flipAnim = useRef(new Animated.Value(cardIsFlipped ? 1 : 0)).current;
  const scaleAnim = useRef(new Animated.Value(cardIsActive ? 1.05 : 1)).current;
  const pixelFadeAnim = useRef(new Animated.Value(isPixelated ? 0 : 1)).current;

  useEffect(() => {
    Animated.timing(flipAnim, {
      toValue: cardIsFlipped ? 1 : 0,
      duration: 380,
      easing: Easing.inOut(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [cardIsFlipped]);

  useEffect(() => {
    Animated.spring(scaleAnim, {
      toValue: cardIsActive ? 1.05 : 1,
      friction: 8,
      tension: 90,
      useNativeDriver: true,
    }).start();
  }, [cardIsActive]);

  useEffect(() => {
    Animated.timing(pixelFadeAnim, {
      toValue: isPixelated ? 0 : 1,
      duration: 280,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [isPixelated]);

  // Törlési animáció: a kártya balra "kirepül" egy kis elfordulással,
  // közben összezsugorodik és elhalványul. Ha lefutott, a szülő
  // ténylegesen eltávolítja a kártyát, a többi pedig felcsúszik a helyére.
  const deleteAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!isDeleting) return;
    Animated.timing(deleteAnim, {
      toValue: 1,
      duration: 340,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) onDeleteAnimationEnd(card.id);
    });
  }, [isDeleting]);

  // Hozzáadási animáció: az újonnan felvett kártya alulról becsúszik,
  // közben felnagyobbodik és előtűnik. Csak akkor fut, ha a kártya
  // frissen létrejött (isNewlyAdded), a meglévő kártyák nem animálnak.
  const enterAnim = useRef(new Animated.Value(isNewlyAdded ? 0 : 1)).current;

  useEffect(() => {
    if (!isNewlyAdded) return;
    enterAnim.setValue(0);
    Animated.timing(enterAnim, {
      toValue: 1,
      duration: 450,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [isNewlyAdded]);

  const enterOpacity = enterAnim.interpolate({
    inputRange: [0, 0.7],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });
  const enterTranslateY = enterAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [50, 0],
  });
  const enterScale = enterAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.9, 1],
  });

  const deleteTranslateX = deleteAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -SCREEN_WIDTH * 1.1],
  });
  const deleteRotate = deleteAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '-14deg'],
  });
  const deleteScale = deleteAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 0.85],
  });
  const deleteOpacity = deleteAnim.interpolate({
    inputRange: [0, 0.55, 1],
    outputRange: [1, 0.9, 0],
  });

  const handleWidthAnim = useRef(new Animated.Value(isReorderMode ? DRAG_HANDLE_WIDTH : 0)).current;

  useEffect(() => {
    const distance = Math.abs(index - reorderReferenceIndex);
    const staggerDelay = Math.min(distance * 40, 260);

    Animated.timing(handleWidthAnim, {
      toValue: isReorderMode ? DRAG_HANDLE_WIDTH : 0,
      duration: 260,
      delay: staggerDelay,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [isReorderMode, reorderReferenceIndex, index]);

  const frontInterpolate = flipAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '180deg'],
  });

  const backInterpolate = flipAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['180deg', '360deg'],
  });

  const frontAnimatedStyle = {
    transform: [{ rotateY: frontInterpolate }, { scale: scaleAnim }],
  };

  const backAnimatedStyle = {
    transform: [{ rotateY: backInterpolate }, { scale: scaleAnim }],
  };

  const baseOffset = index * VISIBLE_HEADER;
  let targetY = baseOffset;

  const isAnySwiped = swipedCardId !== null;
  const isBeingDragged = dragCardId === card.id;

  let effectiveIndex = index;
  if (
    isReorderMode &&
    !isBeingDragged &&
    dragCardId !== null &&
    dragOriginIndex !== null &&
    dragHoverIndex !== null &&
    dragOriginIndex !== dragHoverIndex
  ) {
    if (dragOriginIndex < dragHoverIndex) {
      if (index > dragOriginIndex && index <= dragHoverIndex) {
        effectiveIndex = index - 1;
      }
    } else {
      if (index >= dragHoverIndex && index < dragOriginIndex) {
        effectiveIndex = index + 1;
      }
    }
  }

  if (isExpanded || isAnySwiped || cardIsFlipped || isReorderMode) {
    targetY = effectiveIndex * (CARD_HEIGHT + EXPANDED_GAP);
  } else if (typeof collapsedY === 'number') {
    // Becsukott lista: a szülő számolja ki a helyet, hogy a kedvenc (szívezett)
    // kártyák külön csoportot alkossanak, amire a nem kedvencek nem csúsznak rá.
    targetY = collapsedY;
  }

  const translateYAnim = useRef(new Animated.Value(targetY)).current;

  useEffect(() => {
    if (isBeingDragged) return;

    if (isReorderMode) {
      // Átrendezés közben: fix idejű, lassuló animáció - egyenletesen "csúszik",
      // nem pattan/ugrik, függetlenül attól mekkora a megteendő távolság.
      Animated.timing(translateYAnim, {
        toValue: targetY,
        duration: 260,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    } else {
      Animated.spring(translateYAnim, {
        toValue: targetY,
        tension: 140,
        friction: 18,
        useNativeDriver: true,
      }).start();
    }
  }, [targetY, isBeingDragged, isReorderMode]);

  const indexRef = useRef(index);
  indexRef.current = index;
  const onDragStartRef = useRef(onDragStart);
  onDragStartRef.current = onDragStart;
  const onDragMoveRef = useRef(onDragMove);
  onDragMoveRef.current = onDragMove;
  const onDragEndRef = useRef(onDragEnd);
  onDragEndRef.current = onDragEnd;
  const dragOriginYRef = useRef(0);

  const dragHandlePanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        translateYAnim.stopAnimation((currentValue) => {
          dragOriginYRef.current = currentValue;
        });
        onDragStartRef.current(card.id, indexRef.current);
      },
      onPanResponderMove: (_, gestureState) => {
        translateYAnim.setValue(dragOriginYRef.current + gestureState.dy);
        onDragMoveRef.current(gestureState.dy);
      },
      onPanResponderRelease: () => {
        onDragEndRef.current();
      },
      onPanResponderTerminate: () => {
        onDragEndRef.current();
      },
    })
  ).current;

  useEffect(() => {
    if (swipedCardId !== card.id) {
      Animated.spring(panX, {
        toValue: 0,
        friction: 9,
        tension: 80,
        useNativeDriver: true,
      }).start();
    }
  }, [swipedCardId]);

  const resetSwipe = useCallback(() => {
    setSwipedCardId(null);
    Animated.spring(panX, {
      toValue: 0,
      friction: 9,
      tension: 80,
      useNativeDriver: true,
    }).start();
  }, [setSwipedCardId, panX]);

  const handleLongPress = () => {
    resetSwipe();
    setIsExpanded(true);
    const nextFlippedState = !cardIsFlipped;
    setFlippedCardId(nextFlippedState ? card.id : null);
    if (nextFlippedState) {
      onScrollToCard(index);
    }
  };

  const cardIsActiveRef = useRef(cardIsActive);
  cardIsActiveRef.current = cardIsActive;

  const cardIsFlippedRef = useRef(cardIsFlipped);
  cardIsFlippedRef.current = cardIsFlipped;

  const isReorderModeRef = useRef(isReorderMode);
  isReorderModeRef.current = isReorderMode;

  const swipeToDeleteEnabledRef = useRef(swipeToDeleteEnabled);
  swipeToDeleteEnabledRef.current = swipeToDeleteEnabled;

  const swipeToLinkEnabledRef = useRef(swipeToLinkEnabled);
  swipeToLinkEnabledRef.current = swipeToLinkEnabled;

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, gestureState) => {
        if (cardIsFlippedRef.current || isReorderModeRef.current) return false;
        const { dx, dy } = gestureState;

        if (Math.abs(dx) > Math.abs(dy)) {
          if (dx < 0 && !swipeToDeleteEnabledRef.current) return false;
          if (dx > 0 && !swipeToLinkEnabledRef.current) return false;
        }

        return Math.abs(dx) > 10 || Math.abs(dy) > 10;
      },
      onPanResponderGrant: () => {
        panX.stopAnimation();
      },
      onPanResponderMove: (_, gestureState) => {
        const { dx, dy } = gestureState;

        if (Math.abs(dx) > Math.abs(dy)) {
          if (dx < 0 && swipeToDeleteEnabledRef.current) {
            panX.setValue(Math.max(dx, -80));
          } else if (dx > 0 && swipeToLinkEnabledRef.current) {
            panX.setValue(Math.min(dx, 80));
          }
        }
      },
      onPanResponderRelease: (_, gestureState) => {
        const { dx, dy } = gestureState;

        if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 15) {
          if (dy > 0) {
            setIsExpanded(true);
          } else {
            setIsExpanded(false);
          }
          resetSwipe();
          return;
        }

        if (Math.abs(dx) > Math.abs(dy)) {
          if (dx < -30 && swipeToDeleteEnabledRef.current) {
            if (cardIsActiveRef.current) {
              onSelect(card.id);
            }
            setSwipedCardId(card.id);
            Animated.spring(panX, {
              toValue: -70,
              friction: 9,
              tension: 80,
              useNativeDriver: true,
            }).start();
          } else if (dx > 30 && swipeToLinkEnabledRef.current) {
            if (cardIsActiveRef.current) {
              onSelect(card.id);
            }
            setSwipedCardId(card.id);
            Animated.spring(panX, {
              toValue: 70,
              friction: 9,
              tension: 80,
              useNativeDriver: true,
            }).start();
          } else {
            resetSwipe();
          }
        } else {
          resetSwipe();
        }
      },
      onPanResponderTerminate: () => {
        resetSwipe();
      },
    })
  ).current;

  const validCode = card.code ? String(card.code).trim() : '';
  const isQrCard = isQrCodeType(card.codeType);
  const barcodeFormat = isQrCard ? null : mapBarcodeFormat(card.codeType, card.code);

  const BARCODE_QUIET_ZONE_PX = 14;
  const BARCODE_SINGLE_BAR_WIDTH = 2;

  return (
    <Animated.View
      collapsable={false}
      pointerEvents={isDeleting ? 'none' : 'auto'}
      style={[
        styles.animatedCard,
        {
          opacity: Animated.multiply(deleteOpacity, enterOpacity),
          transform: [
            { translateY: translateYAnim },
            { translateY: enterTranslateY },
            { scale: enterScale },
            { translateX: deleteTranslateX },
            { rotate: deleteRotate },
            { scale: deleteScale },
          ],
          zIndex: isDeleting
            ? 1000
            : cardIsActive || cardIsFlipped || isBeingDragged
            ? 999
            : index + 1,
        },
      ]}
    >
      <View style={styles.swipeCardWrapper} collapsable={false}>
        {swipeToLinkEnabled && (
          <TouchableOpacity
            style={styles.linkIconButton}
            activeOpacity={0.7}
            onPress={() => {
              resetSwipe();
              if (card.linkedAppPackage) {
                onOpenLinkedApp(card.linkedAppPackage);
              } else {
                onOpenAppSelector(card);
              }
            }}
            onLongPress={() => {
              resetSwipe();
              onOpenAppSelector(card);
            }}
          >
            <View style={styles.swipeButtonHighlightEdge} />
            {card.linkedAppIcon ? (
              <Image
                source={{ uri: card.linkedAppIcon }}
                style={styles.linkedIconImage}
              />
            ) : (
              <Plus size={26} color="#ffffff" strokeWidth={2.5} />
            )}
          </TouchableOpacity>
        )}

        {swipeToDeleteEnabled && (
          <TouchableOpacity
            style={styles.deleteIconButton}
            activeOpacity={0.7}
            onPress={() => {
              resetSwipe();
              onDelete(card);
            }}
          >
            <View style={styles.swipeButtonHighlightEdge} />
            <Trash2 size={24} color="#ffffff" strokeWidth={2.5} />
          </TouchableOpacity>
        )}

        <Animated.View
          collapsable={false}
          style={{ transform: [{ translateX: panX }] }}
          {...panResponder.panHandlers}
        >
          <Pressable
            onPress={() => {
              if (cardIsFlipped) {
                setFlippedCardId(null);
                return;
              }
              resetSwipe();
              onSelect(card.id);
            }}
            onLongPress={handleLongPress}
            style={styles.cardTouchable}
          >
            {({ pressed }) => (
              <View style={{ position: 'relative' }}>
                {/* ELŐLAP */}
                <Animated.View
                  style={[
                    styles.walletCard,
                    { backgroundColor: card.color },
                    (cardIsActive || pressed) && styles.activeWalletCard,
                    frontAnimatedStyle,
                    styles.flipCardSide,
                    { backfaceVisibility: 'hidden' },
                  ]}
                >
                  <View style={styles.cardHighlightEdge} />

                  {isQrCard ? (
                    <View style={styles.qrCardRow}>
                      <View style={styles.qrCardLeftCol}>
                        <View style={styles.cardTopRow}>
                          <Text style={styles.cardName} numberOfLines={1} ellipsisMode="tail">
                            {card.name}
                          </Text>
                          <View style={styles.cardTopRowActions}>
                            <TouchableOpacity
                              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                              onPress={() => onToggleFavorite(card.id)}
                            >
                              <Heart
                                size={20}
                                color="#ffffff"
                                fill={card.favorite ? '#ffffff' : 'transparent'}
                                strokeWidth={2}
                              />
                            </TouchableOpacity>
                          </View>
                        </View>

                        {cardIsActive && (
                          <View style={[styles.activeBadge, { alignSelf: 'flex-start' }]}>
                            <Text style={styles.activeBadgeText}>{t.active}</Text>
                          </View>
                        )}
                      </View>

                      <View
                        style={[
                          styles.qrSquareBox,
                          isPixelated && styles.qrSquareBoxHidden,
                        ]}
                      >
                        <Animated.View
                          style={[
                            styles.qrCodeFadeWrapper,
                            { opacity: pixelFadeAnim },
                          ]}
                        >
                          {validCode.length > 0 ? (
                            <QRCode
                              value={validCode}
                              size={116}
                              color="#000000"
                              backgroundColor="transparent"
                            />
                          ) : (
                            <Text style={{ color: '#64748b', fontSize: 12 }}>
                              Nincs kód
                            </Text>
                          )}
                        </Animated.View>
                      </View>
                    </View>
                  ) : (
                    <>
                      <View style={styles.cardTopRow}>
                        <Text style={styles.cardName} numberOfLines={1} ellipsisMode="tail">
                          {card.name}
                        </Text>
                        <View style={styles.cardTopRowActions}>
                          {cardIsActive && (
                            <View style={styles.activeBadge}>
                              <Text style={styles.activeBadgeText}>{t.active}</Text>
                            </View>
                          )}
                          <TouchableOpacity
                            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                            onPress={() => onToggleFavorite(card.id)}
                          >
                            <Heart
                              size={20}
                              color="#ffffff"
                              fill={card.favorite ? '#ffffff' : 'transparent'}
                              strokeWidth={2}
                            />
                          </TouchableOpacity>
                        </View>
                      </View>

                      <View
                        style={[
                          styles.codeContainer,
                          isPixelated && styles.codeContainerHidden,
                        ]}
                      >
                        <Animated.View
                          style={[
                            styles.barcodeFadeWrapper,
                            { opacity: pixelFadeAnim },
                          ]}
                        >
                          <View
                            style={[
                              styles.realBarcodeWrapper,
                              { paddingHorizontal: BARCODE_QUIET_ZONE_PX },
                            ]}
                          >
                            {validCode.length > 0 && barcodeFormat ? (
                              <Barcode
                                value={validCode}
                                format={barcodeFormat}
                                singleBarWidth={BARCODE_SINGLE_BAR_WIDTH}
                                height={40}
                                lineColor="#000000"
                                backgroundColor="transparent"
                                onError={() => {}}
                              />
                            ) : (
                              <Text style={{ color: '#64748b', fontSize: 12 }}>
                                Nincs kód
                              </Text>
                            )}
                          </View>
                          <Text
                            style={styles.cardCodeText}
                            numberOfLines={1}
                            ellipsizeMode="tail"
                          >
                            {validCode}
                          </Text>
                        </Animated.View>
                      </View>
                    </>
                  )}
                </Animated.View>

                {/* HÁTLAP */}
                <Animated.View
                  collapsable={false}
                  pointerEvents={cardIsFlipped ? 'auto' : 'none'}
                  style={[
                    styles.walletCard,
                    styles.cardBack,
                    { backgroundColor: card.color },
                    backAnimatedStyle,
                    styles.flipCardSide,
                    styles.flipCardBackPosition,
                    { backfaceVisibility: 'hidden' },
                  ]}
                >
                  <View style={styles.cardBackActionsColumn}>
                    <TouchableOpacity
                      style={styles.cardBackBtn}
                      activeOpacity={0.8}
                      onPress={() => {
                        setFlippedCardId(null);
                        onEditCard(card);
                      }}
                    >
                      <Edit size={18} color="#ffffff" />
                      <Text style={styles.cardBackBtnText}>{t.editBtn}</Text>
                    </TouchableOpacity>

                    {!swipeToLinkEnabled && (
                      <TouchableOpacity
                        style={[styles.cardBackBtn, { backgroundColor: '#2563eb' }]}
                        activeOpacity={0.8}
                        onPress={() => {
                          setFlippedCardId(null);
                          if (card.linkedAppPackage) {
                            onOpenLinkedApp(card.linkedAppPackage);
                          } else {
                            onOpenAppSelector(card);
                          }
                        }}
                        onLongPress={() => {
                          setFlippedCardId(null);
                          onOpenAppSelector(card);
                        }}
                      >
                        {card.linkedAppIcon ? (
                          <Image
                            source={{ uri: card.linkedAppIcon }}
                            style={styles.cardBackBtnIcon}
                          />
                        ) : (
                          <AppWindow size={18} color="#ffffff" />
                        )}
                        <Text style={styles.cardBackBtnText} numberOfLines={1}>
                          {card.linkedAppPackage
                            ? card.linkedAppLabel || t.linkBtn
                            : t.linkBtn}
                        </Text>
                      </TouchableOpacity>
                    )}

                    {!swipeToDeleteEnabled && (
                      <TouchableOpacity
                        style={[styles.cardBackBtn, { backgroundColor: '#ef4444' }]}
                        activeOpacity={0.8}
                        onPress={() => {
                          setFlippedCardId(null);
                          onDelete(card);
                        }}
                      >
                        <Trash2 size={18} color="#ffffff" />
                        <Text style={styles.cardBackBtnText}>{t.deleteBtn}</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </Animated.View>
              </View>
            )}
          </Pressable>
        </Animated.View>
      </View>
      <Animated.View
        style={[styles.dragHandleZone, { width: handleWidthAnim }]}
        pointerEvents={isReorderMode ? 'auto' : 'none'}
        {...dragHandlePanResponder.panHandlers}
      >
        <View style={styles.dragHandleBar} />
        <View style={styles.dragHandleBar} />
      </Animated.View>
    </Animated.View>
  );
});

export default function App() {
  const [cards, setCards] = useState([]);
  const [currentScreen, setCurrentScreen] = useState('home');
  const [isSettingsVisible, setIsSettingsVisible] = useState(false);
  const [isSearchVisible, setIsSearchVisible] = useState(false);
  const [hideCodes, setHideCodes] = useState(false);
  const [nearbyCardEnabled, setNearbyCardEnabled] = useState(false);
  const [nearbyCardId, setNearbyCardId] = useState(null);
  const nearbyBusyRef = useRef(false);
  const cardsRef = useRef([]);
  const [searchQuery, setSearchQuery] = useState('');

  const scrollViewRef = useRef(null);
  const [listViewportHeight, setListViewportHeight] = useState(0);
  const listScrollY = useRef(new Animated.Value(0)).current;
  const settingsScrollY = useRef(new Animated.Value(0)).current;
  const handleListScroll = useCallback(
    (e) => listScrollY.setValue(e.nativeEvent.contentOffset.y),
    [listScrollY]
  );
  const handleSettingsScroll = useCallback(
    (e) => settingsScrollY.setValue(e.nativeEvent.contentOffset.y),
    [settingsScrollY]
  );
  const searchInputRef = useRef(null);
  const previousBrightnessRef = useRef(null);
  const searchHeaderAnim = useRef(new Animated.Value(0)).current;
  // Az alap fejléc (cím + ikonok) behúzó animációja a kereső bezárásakor
  const titleHeaderAnim = useRef(new Animated.Value(1)).current;
  // A beolvasó (kamera) képernyő alulról becsúszó animációja
  const scanSlideAnim = useRef(new Animated.Value(0)).current;

  const settingsSlideAnim = useRef(new Animated.Value(SCREEN_WIDTH)).current;
  const settingsIconSpin = useRef(new Animated.Value(0)).current;
  const fabAnim = useRef(new Animated.Value(1)).current;

  const modalPanY = useRef(new Animated.Value(0)).current;

  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const hasScannedRef = useRef(false);
  const [scanMode, setScanMode] = useState('add_card');
  const [isCameraReady, setIsCameraReady] = useState(false);

  const [isAppModalVisible, setIsAppModalVisible] = useState(false);
  const [isBackupQrVisible, setIsBackupQrVisible] = useState(false);
  const [targetCardForLink, setTargetCardForLink] = useState(null);
  const [installedAppsList, setInstalledAppsList] = useState([]);
  const [isLoadingApps, setIsLoadingApps] = useState(false);
  const [appSearchQuery, setAppSearchQuery] = useState('');

  // Épp törlés-animációt futtató kártya azonosítója
  const [deletingCardId, setDeletingCardId] = useState(null);
  // Frissen hozzáadott kártya azonosítója (a belépő animációhoz)
  const [newCardId, setNewCardId] = useState(null);

  // Egyedi Alert állapot
  const [alertConfig, setAlertConfig] = useState({
    visible: false,
    title: '',
    message: '',
    buttons: [],
    footerLink: null,
  });

  // Üdvözlő ablak (csak első indításkor, vagy az "Ellenőrzés most" alertből)
  const [welcomeVisible, setWelcomeVisible] = useState(false);

  const showAlert = (
    title,
    message = '',
    buttons = [{ text: 'OK', style: 'cancel' }],
    footerLink = null
  ) => {
    setAlertConfig({
      visible: true,
      title,
      message,
      buttons,
      footerLink,
    });
  };

  const closeWelcome = () => setWelcomeVisible(false);

  // Akkor jegyezzük fel, hogy látta, amikor az ablak tényleg megjelent
  // (zárolt képernyő mögött nem számít megjelenésnek).
  const markWelcomeSeen = () => {
    AsyncStorage.setItem(WELCOME_SEEN_KEY, '1').catch((e) =>
      console.error('Hiba az üdvözlő ablak mentésekor', e)
    );
  };

  const hideAlert = () => {
    setAlertConfig((prev) => ({ ...prev, visible: false }));
  };

  const handleOpenDeveloperURL = (url) => {
    Linking.openURL(url).catch((err) =>
      console.error('Nem sikerült megnyitni az hivatkozást:', err)
    );
  };

  const modalPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gestureState) => gestureState.dy > 5,
      onPanResponderMove: (_, gestureState) => {
        if (gestureState.dy > 0) {
          modalPanY.setValue(gestureState.dy);
        }
      },
      onPanResponderRelease: (_, gestureState) => {
        if (gestureState.dy > 120 || gestureState.vy > 0.5) {
          cancelAddCard();
        } else {
          Animated.spring(modalPanY, {
            toValue: 0,
            friction: 9,
            tension: 80,
            useNativeDriver: true,
          }).start();
        }
      },
    })
  ).current;

  const backupQrPanY = useRef(new Animated.Value(0)).current;

  const backupQrPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gestureState) => gestureState.dy > 5,
      onPanResponderMove: (_, gestureState) => {
        if (gestureState.dy > 0) {
          backupQrPanY.setValue(gestureState.dy);
        }
      },
      onPanResponderRelease: (_, gestureState) => {
        if (gestureState.dy > 120 || gestureState.vy > 0.5) {
          setIsBackupQrVisible(false);
        } else {
          Animated.spring(backupQrPanY, {
            toValue: 0,
            friction: 9,
            tension: 80,
            useNativeDriver: true,
          }).start();
        }
      },
    })
  ).current;

  const [language, setLanguage] = useState('en');
  const [themeMode, setThemeMode] = useState('system');
  const [amoledMode, setAmoledMode] = useState(false);

  const [themeDropdownOpen, setThemeDropdownOpen] = useState(false);
  const [langDropdownOpen, setLangDropdownOpen] = useState(false);
  const [langRowLayout, setLangRowLayout] = useState({ y: 0, height: 0 });
  const [themeRowLayout, setThemeRowLayout] = useState({ y: 0, height: 0 });
  const langChevronAnim = useRef(new Animated.Value(0)).current;
  const themeChevronAnim = useRef(new Animated.Value(0)).current;

  const [swipeToDeleteEnabled, setSwipeToDeleteEnabled] = useState(true);
  const [swipeToLinkEnabled, setSwipeToLinkEnabled] = useState(true);
  const [isLoaded, setIsLoaded] = useState(false);
  const [autoUpdateCheckEnabled, setAutoUpdateCheckEnabled] = useState(false);
  const [brightnessBoostEnabled, setBrightnessBoostEnabled] = useState(true);
  const [brightnessBoostLevel, setBrightnessBoostLevel] = useState(2);
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);

  const [editingCardId, setEditingCardId] = useState(null);
  const [newName, setNewName] = useState('');
  const [detectedCode, setDetectedCode] = useState('');
  const [detectedType, setDetectedType] = useState('CODE128');
  const [selectedColor, setSelectedColor] = useState('#3182CE');
  const [customPickerOpen, setCustomPickerOpen] = useState(false);
  const [addSheetAreaHeight, setAddSheetAreaHeight] = useState(0);
  const [customPanelContentH, setCustomPanelContentH] = useState(0);
  const customPanelProgress = useRef(new Animated.Value(0)).current; // 0..1 (natív)
  const keyboardShiftAnim = useRef(new Animated.Value(0)).current;
  const sheetShiftAnim = useRef(new Animated.Value(0)).current; // natív
  const sheetHeightRef = useRef(0);
  const scrollViewHRef = useRef(0);
  const scrollContentHRef = useRef(0);
  const keyboardShiftValueRef = useRef(0);

  useEffect(() => {
    const id = keyboardShiftAnim.addListener(({ value }) => {
      keyboardShiftValueRef.current = value;
    });
    return () => keyboardShiftAnim.removeListener(id);
  }, [keyboardShiftAnim]);

  // A panel tartalma és az ikon váltása natív animációval fut.
  useEffect(() => {
    Animated.timing(customPanelProgress, {
      toValue: customPickerOpen ? 1 : 0,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [customPickerOpen, customPanelProgress]);

  const animateKeyboardShift = useCallback(
    (to) => {
      Animated.timing(keyboardShiftAnim, {
        toValue: to,
        duration: 340,
        easing: Easing.bezier(0.22, 1, 0.36, 1),
        useNativeDriver: false,
      }).start();
    },
    [keyboardShiftAnim]
  );

  const addSheetBaseMax =
    addSheetAreaHeight > 0
      ? addSheetAreaHeight - ADD_SHEET_TOP_INSET
      : SCREEN_HEIGHT * 0.9;
  const addSheetMaxHeightAnim = useMemo(
    () => Animated.subtract(addSheetBaseMax, keyboardShiftAnim),
    [addSheetBaseMax, keyboardShiftAnim]
  );

  // A színválasztó panel azonnal (egyetlen elrendezés-váltással) nyílik/záródik,
  // a sheet pedig natív animációval csúszik a helyére: a magasságváltozás
  // különbségével eltoljuk, majd 0-ra animáljuk. Így a mozgás nem terheli a
  // JS szálat, nem szaggat.
  const toggleCustomPicker = () => {
    const next = !customPickerOpen;
    const H = customPanelContentH;
    const sheetH = sheetHeightRef.current;
    if (sheetH > 0 && H > 0) {
      const maxH = addSheetBaseMax - keyboardShiftValueRef.current;
      const natural =
        sheetH - scrollViewHRef.current + scrollContentHRef.current;
      const newSheetH = Math.min(next ? natural + H : natural - H, maxH);
      sheetShiftAnim.stopAnimation();
      sheetShiftAnim.setValue(newSheetH - sheetH);
      Animated.timing(sheetShiftAnim, {
        toValue: 0,
        duration: 240,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    }
    setCustomPickerOpen(next);
    if (next) setCustomHexText(selectedColor || '');
  };
  const addSheetOverlayRef = useRef(null);
  const addSheetScrollRef = useRef(null);
  const hexFocusedRef = useRef(false);
  const keyboardTopRef = useRef(null);
  const customPanelYRef = useRef(0);

  // Ha a hex kód mezőre fókuszálunk, a sheet annyival csúszik feljebb,
  // amennyit a billentyűzet eltakarna belőle (egyébként nem mozdul).
  const updateKeyboardOverlap = useCallback(() => {
    if (!hexFocusedRef.current || keyboardTopRef.current === null) {
      return;
    }
    addSheetOverlayRef.current?.measureInWindow((x, y, w, h) => {
      const overlap = Math.max(0, y + h - keyboardTopRef.current);
      animateKeyboardShift(overlap);
      setTimeout(() => {
        addSheetScrollRef.current?.scrollTo({
          y: Math.max(customPanelYRef.current - 10, 0),
          animated: true,
        });
      }, 120);
    });
  }, [animateKeyboardShift]);

  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvt, (e) => {
      keyboardTopRef.current = e.endCoordinates.screenY;
      updateKeyboardOverlap();
    });
    const hideSub = Keyboard.addListener(hideEvt, () => {
      keyboardTopRef.current = null;
      animateKeyboardShift(0);
    });
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, [updateKeyboardOverlap, animateKeyboardShift]);
  const [customHexText, setCustomHexText] = useState('');
  const [activeCardId, setActiveCardId] = useState(null);
  const [swipedCardId, setSwipedCardId] = useState(null);
  const [flippedCardId, setFlippedCardId] = useState(null);
  const [dragCardId, setDragCardId] = useState(null);
  const [dragOriginIndex, setDragOriginIndex] = useState(null);
  const [dragHoverIndex, setDragHoverIndex] = useState(null);
  const dragOriginIndexRef = useRef(null);
  const filteredCardsRef = useRef([]);

  const [isExpanded, setIsExpanded] = useState(false);

  const systemColorScheme = useColorScheme();
  const isDarkMode =
    themeMode === 'system'
      ? systemColorScheme === 'dark'
      : themeMode === 'dark';

  useEffect(() => {
    const bgColor = isDarkMode
      ? amoledMode
        ? THEME_BG_COLORS.amoled
        : THEME_BG_COLORS.dark
      : THEME_BG_COLORS.light;

    SystemUI.setBackgroundColorAsync(bgColor).catch((e) => {
      console.error('Hiba a rendszer-háttérszín beállításakor', e);
    });
  }, [isDarkMode, amoledMode]);

  const t = translations[language] || translations.en;
  const currentLangLabel = languagesList.find((l) => l.id === language)?.label || 'English';

  useEffect(() => {
    Animated.timing(langChevronAnim, {
      toValue: langDropdownOpen ? 1 : 0,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [langDropdownOpen]);

  useEffect(() => {
    Animated.timing(themeChevronAnim, {
      toValue: themeDropdownOpen ? 1 : 0,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [themeDropdownOpen]);

  const langChevronRotate = langChevronAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '180deg'],
  });
  const themeChevronRotate = themeChevronAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '180deg'],
  });

  useEffect(() => {
    let isMounted = true;
    loadAllData(isMounted);
    authenticate();
    return () => {
      isMounted = false;
    };
  }, []);

  const authenticate = async () => {
    setIsCheckingAuth(true);
    try {
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      const isEnrolled = await LocalAuthentication.isEnrolledAsync();

      // A telefon képernyőzárja (PIN / minta / jelszó) is érvényes azonosítás,
      // nem csak az ujjlenyomat / arcfelismerés.
      let hasDeviceLock = false;
      try {
        const level = await LocalAuthentication.getEnrolledLevelAsync();
        hasDeviceLock = level !== LocalAuthentication.SecurityLevel.NONE;
      } catch (levelErr) {
        hasDeviceLock = false;
      }

      if (!(hasHardware && isEnrolled) && !hasDeviceLock) {
        setIsAuthenticated(true);
        setIsCheckingAuth(false);
        return;
      }

      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: translations[language]?.authPromptMessage || translations.en.authPromptMessage,
        cancelLabel: translations[language]?.authCancel || translations.en.authCancel,
        disableDeviceFallback: false,
      });

      setIsAuthenticated(!!result.success);
    } catch (e) {
      console.error('Hiba a hitelesítés során', e);
      setIsAuthenticated(false);
    } finally {
      setIsCheckingAuth(false);
    }
  };

  useEffect(() => {
    if (isLoaded) {
      saveCards(cards);
    }
  }, [cards, isLoaded]);

  useEffect(() => {
    if (isLoaded) {
      saveSettings();
    }
  }, [language, swipeToDeleteEnabled, swipeToLinkEnabled, themeMode, amoledMode, autoUpdateCheckEnabled, brightnessBoostEnabled, brightnessBoostLevel, hideCodes, nearbyCardEnabled, isLoaded]);

  useEffect(() => {
    if (!isExpanded && swipedCardId === null && flippedCardId === null) {
      scrollViewRef.current?.scrollTo({
        y: 0,
        animated: true,
      });
    }
  }, [isExpanded, swipedCardId, flippedCardId]);

  // Szerkesztés / átrendezés (kártya átfordítása) esetén az aktív állapot megszűnik
  useEffect(() => {
    if (flippedCardId !== null) {
      setActiveCardId(null);
    }
  }, [flippedCardId]);

  useEffect(() => {
    if (currentScreen === 'add_card') {
      modalPanY.setValue(0);
    }
  }, [currentScreen, modalPanY]);

  useEffect(() => {
    if (isBackupQrVisible) {
      backupQrPanY.setValue(0);
    }
  }, [isBackupQrVisible, backupQrPanY]);

  const loadAllData = async (isMounted) => {
    try {
      const storedCards = await AsyncStorage.getItem('@loyalty_cards');
      if (storedCards !== null && isMounted) {
        setCards(JSON.parse(storedCards));
      }

      const storedLang = await AsyncStorage.getItem('@language');
      if (storedLang !== null && isMounted) {
        const parsedLang = JSON.parse(storedLang);
        if (translations[parsedLang]) {
          setLanguage(parsedLang);
        }
      }

      const storedSwipePref = await AsyncStorage.getItem('@swipe_to_delete');
      if (storedSwipePref !== null && isMounted) {
        setSwipeToDeleteEnabled(JSON.parse(storedSwipePref));
      }

      const storedLinkPref = await AsyncStorage.getItem('@swipe_to_link');
      if (storedLinkPref !== null && isMounted) {
        setSwipeToLinkEnabled(JSON.parse(storedLinkPref));
      }

      const storedThemePref = await AsyncStorage.getItem('@theme_mode');
      if (storedThemePref !== null && isMounted) {
        setThemeMode(JSON.parse(storedThemePref));
      }

      const storedAmoledPref = await AsyncStorage.getItem('@amoled_mode');
      if (storedAmoledPref !== null && isMounted) {
        setAmoledMode(JSON.parse(storedAmoledPref));
      }

      const storedAutoUpdatePref = await AsyncStorage.getItem('@auto_update_check');
      if (storedAutoUpdatePref !== null && isMounted) {
        setAutoUpdateCheckEnabled(JSON.parse(storedAutoUpdatePref));
      }

      const storedBrightnessBoostPref = await AsyncStorage.getItem('@brightness_boost');
      if (storedBrightnessBoostPref !== null && isMounted) {
        setBrightnessBoostEnabled(JSON.parse(storedBrightnessBoostPref));
      }

      const storedBrightnessBoostLevel = await AsyncStorage.getItem('@brightness_boost_level');
      if (storedBrightnessBoostLevel !== null && isMounted) {
        setBrightnessBoostLevel(JSON.parse(storedBrightnessBoostLevel));
      }

      const storedHideCodes = await AsyncStorage.getItem('@hide_codes');
      if (storedHideCodes !== null && isMounted) {
        setHideCodes(JSON.parse(storedHideCodes) === true);
      }

      const storedNearbyPref = await AsyncStorage.getItem('@nearby_card');
      if (storedNearbyPref !== null && isMounted) {
        setNearbyCardEnabled(JSON.parse(storedNearbyPref) === true);
      }

      const welcomeSeen = await AsyncStorage.getItem(WELCOME_SEEN_KEY);
      if (welcomeSeen === null && isMounted) {
        setWelcomeVisible(true);
      }

      const shouldAutoCheck =
        storedAutoUpdatePref !== null ? JSON.parse(storedAutoUpdatePref) : false;
      if (shouldAutoCheck && isMounted) {
        checkForUpdates(false);
      }
    } catch (e) {
      console.error('Hiba az adatok betöltésekor', e);
    } finally {
      if (isMounted) {
        setIsLoaded(true);
      }
    }
  };

  const openSettings = () => {
    settingsScrollY.setValue(0);
    setIsSettingsVisible(true);
    Animated.spring(settingsSlideAnim, {
      toValue: 0,
      friction: 22,
      tension: 140,
      useNativeDriver: true,
    }).start();
  };

  const closeSettings = () => {
    setThemeDropdownOpen(false);
    setLangDropdownOpen(false);

    settingsIconSpin.setValue(0);

    // A fogaskerék a beállítások panel mögött van, ezért a pörgés csak
    // akkor látszana, ha a panel már elcsúszott – így a panel kicsúszása
    // után indítjuk, és az animáció a panel eltűnése után is lefut.
    Animated.timing(settingsSlideAnim, {
      toValue: SCREEN_WIDTH,
      duration: 260,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(() => {
      setIsSettingsVisible(false);
      Animated.timing(settingsIconSpin, {
        toValue: 1,
        duration: 520,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    });
  };

  useEffect(() => {
    if (Platform.OS !== 'android') return;

    const onHardwareBackPress = () => {
      if (isSettingsVisible) {
        closeSettings();
        return true;
      }
      return false;
    };

    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      onHardwareBackPress
    );

    return () => subscription.remove();
  }, [isSettingsVisible]);

  const openSearch = () => {
    resetSelection();
    setIsSearchVisible(true);
    searchHeaderAnim.setValue(0);
    Animated.timing(searchHeaderAnim, {
      toValue: 1,
      duration: 260,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
    setTimeout(() => searchInputRef.current?.focus(), 60);
  };

  const closeSearch = () => {
    Animated.timing(searchHeaderAnim, {
      toValue: 0,
      duration: 200,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(() => {
      // Az app neve és az ikonok felülről csúsznak vissza a helyükre.
      titleHeaderAnim.setValue(0);
      setIsSearchVisible(false);
      setSearchQuery('');
      Animated.timing(titleHeaderAnim, {
        toValue: 1,
        duration: 300,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    });
  };

  // --- Helyalapú előrehozás --------------------------------------------------
  cardsRef.current = cards;

  const checkNearbyStore = useCallback(async () => {
    if (nearbyBusyRef.current) return;
    nearbyBusyRef.current = true;
    try {
      const perm = await Location.getForegroundPermissionsAsync();
      if (!perm.granted || cardsRef.current.length === 0) {
        setNearbyCardId(null);
        return;
      }
      const { coords } = await getDevicePosition();
      // Túl pontatlan hely (pl. hozzávetőleges engedély, kilométeres hiba) esetén
      // nem döntünk, nehogy rossz kártya ugorjon fel.
      if (coords.accuracy != null && coords.accuracy > NEARBY_MAX_ACCURACY_M) return;
      const places = await getPlacesForPosition(coords.latitude, coords.longitude);
      // Nincs net és nincs mentett adat: csendben marad minden a régiben.
      if (!places) return;

      // A pontos egyezést a telefon számolja: a legközelebbi, 100 méteren belüli
      // üzlet nevével egyező kártya nyer.
      let bestId = null;
      let bestDist = Infinity;
      for (const [name, pLat, pLon] of places) {
        const d = distanceMeters(coords.latitude, coords.longitude, pLat, pLon);
        if (d > NEARBY_RADIUS_M || d >= bestDist) continue;
        const match = cardsRef.current.find((c) => namesMatch(c.name, name));
        if (match) {
          bestDist = d;
          bestId = match.id;
        }
      }
      setNearbyCardId(bestId);
    } catch (e) {
      // csendben: se hibaüzenet, se változás
    } finally {
      nearbyBusyRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (!isLoaded || !nearbyCardEnabled) {
      setNearbyCardId(null);
      return;
    }
    checkNearbyStore();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') checkNearbyStore();
    });
    const timer = setInterval(() => {
      if (AppState.currentState === 'active') checkNearbyStore();
    }, NEARBY_POLL_MS);
    return () => {
      sub.remove();
      clearInterval(timer);
    };
  }, [isLoaded, nearbyCardEnabled, checkNearbyStore]);

  const handleToggleNearbyCard = async (value) => {
    if (!value) {
      setNearbyCardEnabled(false);
      resetNearbyMemo();
      return;
    }
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        showAlert(t.alertWarning, t.locationPermissionDenied);
        return;
      }
      setNearbyCardEnabled(true);
    } catch (e) {
      showAlert(t.alertWarning, t.locationPermissionDenied);
    }
  };

  // A tárolt sorrendhez nem nyúlunk: a közeli bolt kártyáját csak megjelenítéskor
  // tesszük előre.
  const nearbyCard = nearbyCardEnabled && nearbyCardId
    ? cards.find((c) => c.id === nearbyCardId)
    : null;
  // A kedvenc (szívezett) kártyák mindig a lista elején vannak (a saját
  // sorrendjüket megtartva), utánuk jönnek a többiek.
  const favoritesFirstCards = [
    ...cards.filter((c) => c.favorite),
    ...cards.filter((c) => !c.favorite),
  ];
  const baseCards = nearbyCard
    ? [nearbyCard, ...favoritesFirstCards.filter((c) => c.id !== nearbyCard.id)]
    : favoritesFirstCards;

  const filteredCards = isSearchVisible && searchQuery.trim()
    ? baseCards.filter((card) =>
        (card.name || '').toLowerCase().includes(searchQuery.trim().toLowerCase())
      )
    : baseCards;

  filteredCardsRef.current = filteredCards;

  const hasListScroll =
    cards.length > 0 &&
    !(isSearchVisible && !!searchQuery.trim() && filteredCards.length === 0);
  useEffect(() => {
    listScrollY.setValue(0);
  }, [hasListScroll, listScrollY]);

  const isReorderMode = flippedCardId !== null;
  const ROW_HEIGHT = CARD_HEIGHT + EXPANDED_GAP;

  const flippedIndex = flippedCardId
    ? filteredCards.findIndex((c) => c.id === flippedCardId)
    : -1;
  const reorderReferenceIndexRef = useRef(0);
  if (flippedIndex !== -1) {
    reorderReferenceIndexRef.current = flippedIndex;
  }
  const reorderReferenceIndex = reorderReferenceIndexRef.current;

  const handleDragStart = useCallback((cardId, index) => {
    dragOriginIndexRef.current = index;
    setDragCardId(cardId);
    setDragOriginIndex(index);
    setDragHoverIndex(index);
  }, []);

  const handleDragMove = useCallback((dy) => {
    const origin = dragOriginIndexRef.current;
    if (origin === null) return;
    const raw = origin + Math.round(dy / ROW_HEIGHT);
    // A kártya csak a saját csoportján belül mozgatható: kedvenc a kedvencek
    // között, nem kedvenc a nem kedvencek között.
    const list = filteredCardsRef.current;
    const group = (c) => (c.favorite ? 1 : 0);
    const movedGroup = list[origin] ? group(list[origin]) : 0;
    let min = origin;
    let max = origin;
    while (min > 0 && group(list[min - 1]) === movedGroup) min--;
    while (max < list.length - 1 && group(list[max + 1]) === movedGroup) max++;
    const clamped = Math.max(min, Math.min(max, raw));
    setDragHoverIndex((prev) => (prev === clamped ? prev : clamped));
  }, []);

  const handleDragEnd = useCallback(() => {
    const origin = dragOriginIndexRef.current;
    setDragHoverIndex((hover) => {
      if (origin !== null && hover !== null && origin !== hover) {
        const currentFiltered = filteredCardsRef.current;
        const movedCard = currentFiltered[origin];
        const neighborCard = currentFiltered[hover];
        if (movedCard) {
          setCards((prevCards) => {
            const withoutMoved = prevCards.filter((c) => c.id !== movedCard.id);
            let insertAt = withoutMoved.length;
            if (neighborCard && neighborCard.id !== movedCard.id) {
              const neighborPos = withoutMoved.findIndex(
                (c) => c.id === neighborCard.id
              );
              insertAt = origin < hover ? neighborPos + 1 : neighborPos;
            }
            const newCards = [...withoutMoved];
            newCards.splice(insertAt, 0, movedCard);
            return newCards;
          });
        }
      }
      return null;
    });
    dragOriginIndexRef.current = null;
    setDragOriginIndex(null);
    setDragCardId(null);
  }, []);

  const spinDegree = settingsIconSpin.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  const saveCards = async (newCards) => {
    try {
      await AsyncStorage.setItem('@loyalty_cards', JSON.stringify(newCards));
    } catch (e) {
      console.error('Hiba a kártyák mentésekor', e);
    }
  };

  const saveSettings = async () => {
    try {
      await AsyncStorage.setItem('@language', JSON.stringify(language));
      await AsyncStorage.setItem(
        '@swipe_to_delete',
        JSON.stringify(swipeToDeleteEnabled)
      );
      await AsyncStorage.setItem(
        '@swipe_to_link',
        JSON.stringify(swipeToLinkEnabled)
      );
      await AsyncStorage.setItem('@theme_mode', JSON.stringify(themeMode));
      await AsyncStorage.setItem('@amoled_mode', JSON.stringify(amoledMode));
      await AsyncStorage.setItem(
        '@auto_update_check',
        JSON.stringify(autoUpdateCheckEnabled)
      );
      await AsyncStorage.setItem(
        '@brightness_boost',
        JSON.stringify(brightnessBoostEnabled)
      );
      await AsyncStorage.setItem(
        '@brightness_boost_level',
        JSON.stringify(brightnessBoostLevel)
      );
      await AsyncStorage.setItem('@hide_codes', JSON.stringify(hideCodes));
      await AsyncStorage.setItem('@nearby_card', JSON.stringify(nearbyCardEnabled));
    } catch (e) {
      console.error('Hiba a beállítások mentésekor', e);
    }
  };

  const buildBackupPayload = () => ({
    appId: 'quickwallet-backup',
    version: 1,
    exportedAt: new Date().toISOString(),
    data: {
      cards,
      language,
      swipeToDeleteEnabled,
      swipeToLinkEnabled,
      themeMode,
      amoledMode,
      autoUpdateCheckEnabled,
      brightnessBoostEnabled,
      brightnessBoostLevel,
      hideCodes,
    },
  });

  // QR / megosztás csomag: CSAK a kártyák adatai (név, kód, típus, szín).
  // Az alkalmazás beállításai, a társított appok és az ikonjaik nem kerülnek bele.
  const buildSharePayload = () => ({
    appId: 'quickwallet-share',
    version: 1,
    data: {
      cards: cards.map((c) => ({
        name: c.name,
        code: c.code,
        codeType: c.codeType,
        color: c.color,
      })),
    },
  });

  const shareCardsFile = async () => {
    try {
      const fileUri =
        FileSystem.cacheDirectory +
        `${t.shareFileName}_${new Date().toISOString().slice(0, 10)}.json`;

      await FileSystem.writeAsStringAsync(
        fileUri,
        JSON.stringify(buildSharePayload(), null, 2),
        { encoding: FileSystem.EncodingType.UTF8 }
      );

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(fileUri, {
          mimeType: 'application/json',
          dialogTitle: t.backupExport,
          UTI: 'public.json',
        });
      } else {
        showAlert(t.alertWarning, t.backupExportError);
      }
    } catch (e) {
      console.error('Hiba a kártyák megosztásakor', e);
      showAlert(t.alertWarning, t.backupExportError);
    }
  };

  const getBackupFileName = () =>
    `quickwallet_backup_${new Date().toISOString().slice(0, 10)}.json`;

  const exportBackup = async () => {
    try {
      const backupPayload = buildBackupPayload();
      const fileUri = FileSystem.cacheDirectory + getBackupFileName();

      await FileSystem.writeAsStringAsync(
        fileUri,
        JSON.stringify(backupPayload, null, 2),
        { encoding: FileSystem.EncodingType.UTF8 }
      );

      const isSharingAvailable = await Sharing.isAvailableAsync();
      if (isSharingAvailable) {
        await Sharing.shareAsync(fileUri, {
          mimeType: 'application/json',
          dialogTitle: t.backupExport,
          UTI: 'public.json',
        });
      } else {
        showAlert(t.alertWarning, t.backupExportError);
      }
    } catch (e) {
      console.error('Hiba a biztonsági mentés készítésekor', e);
      showAlert(t.alertWarning, t.backupExportError);
    }
  };

  const downloadBackup = async () => {
    try {
      const backupPayload = buildBackupPayload();
      const jsonString = JSON.stringify(backupPayload, null, 2);
      const fileName = getBackupFileName();

      if (Platform.OS === 'android') {
        const permissions =
          await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();

        if (!permissions.granted) {
          return;
        }

        const destinationUri =
          await FileSystem.StorageAccessFramework.createFileAsync(
            permissions.directoryUri,
            fileName,
            'application/json'
          );

        await FileSystem.writeAsStringAsync(destinationUri, jsonString, {
          encoding: FileSystem.EncodingType.UTF8,
        });

        showAlert(t.alertWarning, t.backupExportSuccess);
      } else {
        await exportBackup();
      }
    } catch (e) {
      console.error('Hiba a biztonsági mentés letöltésekor', e);
      showAlert(t.alertWarning, t.backupExportError);
    }
  };

  const compareVersions = (a, b) => {
    const pa = String(a).replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
    const pb = String(b).replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
    const len = Math.max(pa.length, pb.length);
    for (let i = 0; i < len; i++) {
      const na = pa[i] || 0;
      const nb = pb[i] || 0;
      if (na > nb) return 1;
      if (na < nb) return -1;
    }
    return 0;
  };

  const checkForUpdates = async (manual) => {
    if (GITHUB_REPO_SLUG.includes('PLACEHOLDER')) {
      if (manual) {
        showAlert(t.alertWarning, t.updateRepoNotConfigured);
      }
      return;
    }

    if (manual) setIsCheckingUpdate(true);

    try {
      const response = await fetch(
        `https://api.github.com/repos/${GITHUB_REPO_SLUG}/releases/latest`
      );
      if (!response.ok) {
        throw new Error(`GitHub API status ${response.status}`);
      }
      const release = await response.json();
      const latestVersion = release.tag_name || '';
      const currentVersion = Application.nativeApplicationVersion || '0.0.0';

      if (latestVersion && compareVersions(latestVersion, currentVersion) > 0) {
        const releasePageUrl =
          release.html_url ||
          `https://github.com/${GITHUB_REPO_SLUG}/releases/latest`;

        showAlert(
          t.updateAvailableTitle,
          t.updateAvailableMessage.replace('{version}', latestVersion),
          [
            { text: t.cancel, style: 'cancel' },
            {
              text: t.updateInstallBtn,
              onPress: () => {
                Linking.openURL(releasePageUrl).catch((e) => {
                  console.error('Nem sikerült megnyitni a GitHub oldalt', e);
                  showAlert(t.alertWarning, t.updateDownloadError);
                });
              },
            },
          ]
        );
      } else if (manual) {
        showAlert(
          t.alertWarning,
          t.updateUpToDate,
          [{ text: 'OK', style: 'cancel' }],
          {
            text: t.welcomeShowAgain,
            // Kis késleltetés, hogy az alert Modal előbb bezáródjon (iOS-en
            // két Modal egyszerre nem nyílhat/zárulhat megbízhatóan).
            onPress: () => setTimeout(() => setWelcomeVisible(true), 350),
          }
        );
      }
    } catch (e) {
      console.error('Hiba a frissítés ellenőrzésekor', e);
      if (manual) showAlert(t.alertWarning, t.updateCheckError);
    } finally {
      if (manual) setIsCheckingUpdate(false);
    }
  };


  // Fájlból való visszaállítás: MINDIG felülírja a jelenlegi adatokat,
  // a kártyákat és az összes beállítást is.
  const applyRestoredBackupData = async (restoredData) => {
    try {
      const newCards = Array.isArray(restoredData.cards) ? restoredData.cards : [];
      const newLanguage = translations[restoredData.language] ? restoredData.language : language;
      const newSwipeDelete = restoredData.swipeToDeleteEnabled ?? swipeToDeleteEnabled;
      const newSwipeLink = restoredData.swipeToLinkEnabled ?? swipeToLinkEnabled;
      const newThemeMode = ['system', 'light', 'dark'].includes(restoredData.themeMode)
        ? restoredData.themeMode
        : themeMode;
      const newAmoledMode = restoredData.amoledMode ?? amoledMode;
      const newAutoUpdate = restoredData.autoUpdateCheckEnabled ?? autoUpdateCheckEnabled;
      const newBrightnessBoost = restoredData.brightnessBoostEnabled ?? brightnessBoostEnabled;
      const newHideCodes = restoredData.hideCodes ?? hideCodes;
      const newBrightnessLevel =
        Number.isInteger(restoredData.brightnessBoostLevel) &&
        restoredData.brightnessBoostLevel >= 0 &&
        restoredData.brightnessBoostLevel < BRIGHTNESS_BOOST_LEVELS.length
          ? restoredData.brightnessBoostLevel
          : brightnessBoostLevel;

      setCards(newCards);
      setLanguage(newLanguage);
      setSwipeToDeleteEnabled(!!newSwipeDelete);
      setSwipeToLinkEnabled(!!newSwipeLink);
      setThemeMode(newThemeMode);
      setAmoledMode(!!newAmoledMode);
      setAutoUpdateCheckEnabled(!!newAutoUpdate);
      setBrightnessBoostEnabled(!!newBrightnessBoost);
      setBrightnessBoostLevel(newBrightnessLevel);
      setHideCodes(!!newHideCodes);
      setActiveCardId(null);
      setSwipedCardId(null);
      setFlippedCardId(null);
      setIsExpanded(false);

      await AsyncStorage.setItem('@loyalty_cards', JSON.stringify(newCards));
      await AsyncStorage.setItem('@language', JSON.stringify(newLanguage));
      await AsyncStorage.setItem('@swipe_to_delete', JSON.stringify(!!newSwipeDelete));
      await AsyncStorage.setItem('@swipe_to_link', JSON.stringify(!!newSwipeLink));
      await AsyncStorage.setItem('@theme_mode', JSON.stringify(newThemeMode));
      await AsyncStorage.setItem('@amoled_mode', JSON.stringify(!!newAmoledMode));
      await AsyncStorage.setItem('@auto_update_check', JSON.stringify(!!newAutoUpdate));
      await AsyncStorage.setItem('@brightness_boost', JSON.stringify(!!newBrightnessBoost));
      await AsyncStorage.setItem('@brightness_boost_level', JSON.stringify(newBrightnessLevel));
      await AsyncStorage.setItem('@hide_codes', JSON.stringify(!!newHideCodes));

      showAlert(translations[newLanguage].alertWarning, translations[newLanguage].backupImportSuccess);
    } catch (innerErr) {
      console.error('Hiba a visszaállítás alkalmazásakor', innerErr);
      showAlert(t.alertWarning, t.backupImportError);
    }
  };

  // Biztonsági mentés fájl: nincs hozzáadás / csere választás, csak felülírás.
  const confirmAndRestoreBackup = (restoredData) => {
    showAlert(
      t.backupImportTitle,
      t.backupImportConfirm,
      [
        { text: t.cancel, style: 'cancel' },
        {
          text: t.backupRestoreBtn,
          style: 'destructive',
          onPress: () => applyRestoredBackupData(restoredData),
        },
      ]
    );
  };

  // Megosztással kapott kártyák: kérdés ablak, hogy hozzáadja vagy lecserélje
  // a jelenlegi kártyákat.
  const normalizeReceivedCards = (receivedCards) =>
    receivedCards
      .filter((c) => c && c.code !== undefined && c.code !== null && String(c.code) !== '')
      .map((c, i) => ({
        id: (Date.now() + i).toString(),
        name: String(c.name || ''),
        code: String(c.code),
        codeType: c.codeType || 'CODE128',
        color: c.color || '#3182CE',
        linkedAppPackage: null,
        linkedAppIcon: null,
      }));

  // Csak hozzáadja a kapott kártyákat a meglévőkhöz (a pontos duplikációkat
  // kihagyja), a beállításokhoz nem nyúl.
  const addReceivedCards = (valid) => {
    const existingKeys = new Set(
      cards.map((c) => `${c.name}|${c.code}|${c.codeType}`)
    );
    const toAdd = valid.filter(
      (c) => !existingKeys.has(`${c.name}|${c.code}|${c.codeType}`)
    );
    if (toAdd.length > 0) {
      setCards((prev) => [...prev, ...toAdd]);
      setActiveCardId(null);
      setSwipedCardId(null);
      setFlippedCardId(null);
      setIsExpanded(false);
    }
    setTimeout(
      () =>
        showAlert(
          t.alertWarning,
          toAdd.length > 0
            ? t.shareAddedSuccess.replace('{count}', String(toAdd.length))
            : t.shareNoNewCards
        ),
      350
    );
  };

  const confirmShareImport = (receivedCards) => {
    const valid = normalizeReceivedCards(receivedCards);

    if (valid.length === 0) {
      showAlert(t.alertWarning, t.shareInvalid);
      return;
    }

    const finishUi = () => {
      setActiveCardId(null);
      setSwipedCardId(null);
      setFlippedCardId(null);
      setIsExpanded(false);
    };

    showAlert(
      t.shareReceiveTitle,
      t.shareReceiveMessage.replace('{count}', String(valid.length)),
      [
        { text: t.cancel, style: 'cancel' },
        {
          text: t.shareReplaceBtn,
          style: 'destructive',
          onPress: () => {
            setCards(valid);
            finishUi();
            setTimeout(
              () =>
                showAlert(
                  t.alertWarning,
                  t.shareReplacedSuccess.replace('{count}', String(valid.length))
                ),
              350
            );
          },
        },
        {
          text: t.shareAddBtn,
          onPress: () => addReceivedCards(valid),
        },
      ]
    );
  };

  // Megpróbálja a beolvasott QR/vonalkód szövegét biztonsági mentés
  // adatcsomagként értelmezni. Ha sikerül, elindítja a visszaállítás
  // megerősítő párbeszédablakát és true-val tér vissza, egyébként
  // false-t ad vissza (ekkor a hívó a szokásos kártya-hozzáadás
  // folyamatával folytathatja).
  const tryImportBackupFromScannedText = (rawText) => {
    try {
      const parsed = JSON.parse(rawText);
      const restoredData = parsed?.data ?? parsed;

      if (
        parsed?.appId === 'quickwallet-share' &&
        Array.isArray(restoredData?.cards)
      ) {
        confirmShareImport(restoredData.cards);
        return true;
      }

      if (
        parsed?.appId === 'quickwallet-backup' &&
        restoredData &&
        Array.isArray(restoredData.cards)
      ) {
        confirmAndRestoreBackup(restoredData);
        return true;
      }
    } catch (e) {
      // Nem JSON / nem biztonsági mentés — folytatás normál kód beolvasásként.
    }
    return false;
  };

  const importBackup = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/json', 'text/plain', '*/*'],
        copyToCacheDirectory: true,
      });

      if (result.canceled || !result.assets || result.assets.length === 0) {
        return;
      }

      const fileUri = result.assets[0].uri;
      const fileContent = await FileSystem.readAsStringAsync(fileUri, {
        encoding: FileSystem.EncodingType.UTF8,
      });

      const parsed = JSON.parse(fileContent);
      const restoredData = parsed?.data ?? parsed;

      if (!restoredData || !Array.isArray(restoredData.cards)) {
        showAlert(t.alertWarning, t.backupImportError);
        return;
      }

      if (parsed?.appId === 'quickwallet-share') {
        confirmShareImport(restoredData.cards);
        return;
      }

      confirmAndRestoreBackup(restoredData);
    } catch (e) {
      console.error('Hiba a fájl beolvasásakor', e);
      showAlert(t.alertWarning, t.backupImportError);
    }
  };

  const handleBarcodeScanned = ({ data, type }) => {
    if (hasScannedRef.current) return;
    hasScannedRef.current = true;
    setScanned(true);

    if (tryImportBackupFromScannedText(String(data))) {
      setIsCameraReady(false);
      setCurrentScreen('home');
      return;
    }

    if (scanMode === 'backup_import') {
      // Nem biztonsági mentés QR-kódot olvastunk be ebben a módban —
      // jelezzük, és engedjük újra próbálkozni, ahelyett hogy
      // kártya-hozzáadásba kezdenénk.
      showAlert(t.alertWarning, t.backupQrInvalidScan);
      setScanned(false);
      hasScannedRef.current = false;
      return;
    }

    setDetectedCode(String(data));
    setDetectedType(normalizeBarcodeType(type) || 'CODE128');
    setIsCameraReady(false);
    setCurrentScreen('add_card');
  };

  const slideInScanScreen = () => {
    scanSlideAnim.setValue(SCREEN_HEIGHT);
    Animated.timing(scanSlideAnim, {
      toValue: 0,
      duration: 340,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  };

  const startScanning = async () => {
    const res = await requestPermission();
    if (!res.granted) {
      showAlert(t.alertWarning, t.camPermissionDenied);
      return;
    }
    setScanMode('add_card');
    setScanned(false);
    hasScannedRef.current = false;
    setIsCameraReady(false);
    slideInScanScreen();
    setCurrentScreen('scan_barcode');

    setTimeout(() => {
      setIsCameraReady(true);
    }, 150);
  };

  const startBackupQrScan = async () => {
    const res = await requestPermission();
    if (!res.granted) {
      showAlert(t.alertWarning, t.camPermissionDenied);
      return;
    }
    setScanMode('backup_import');
    setScanned(false);
    hasScannedRef.current = false;
    setIsCameraReady(false);
    slideInScanScreen();
    setCurrentScreen('scan_barcode');

    setTimeout(() => {
      setIsCameraReady(true);
    }, 150);
  };

  const pickImageAndScanBarcode = async () => {
    try {
      const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permissionResult.granted) {
        showAlert(t.alertWarning, t.galleryPermissionDenied);
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: false,
        quality: 1,
      });

      if (result.canceled || !result.assets || result.assets.length === 0) {
        return;
      }

      const selectedUri = result.assets[0].uri;

      // Először kifejezetten QR-kódot keresünk a képen (szűkített
      // típuslistával) — ez megbízhatóbb, mint ha rögtön az összes
      // vonalkód-formátumot egyszerre próbáljuk felismerni, mert
      // állóképen a vegyes típuslistás keresés néha tévesen más
      // formátumként (pl. Code128) azonosítja a QR mintázatot.
      let scannedBarcodes = await scanFromURLAsync(selectedUri, ['qr']);

      if (!scannedBarcodes || scannedBarcodes.length === 0) {
        scannedBarcodes = await scanFromURLAsync(
          selectedUri,
          BARCODE_SCAN_TYPES
        );
      }

      if (!scannedBarcodes || scannedBarcodes.length === 0) {
        showAlert(t.alertWarning, t.noCodeInImage);
        return;
      }

      // Ha több kódot is talál a képen, a valódi QR-kódot részesítjük
      // előnyben más (esetleg tévesen felismert) formátumokkal szemben.
      const qrMatch = scannedBarcodes.find((b) => isQrCodeType(b.type));
      const barcode = qrMatch || scannedBarcodes[0];

      if (tryImportBackupFromScannedText(String(barcode.data))) {
        return;
      }

      setDetectedCode(String(barcode.data));
      setDetectedType(normalizeBarcodeType(barcode.type) || 'CODE128');
    } catch (e) {
      console.error('Hiba a kép beolvasásakor', e);
      showAlert(t.alertWarning, `Hiba a képernyőkép beolvasása során: ${e?.message || String(e)}`);
    }
  };

  const colorPalette = [
    '#3182CE',
    '#E53E3E',
    '#6C127D',
    '#00B050',
    '#FFC000',
    '#64748B',
  ];

  const themeBgColor = isDarkMode
    ? amoledMode
      ? THEME_BG_COLORS.amoled
      : THEME_BG_COLORS.dark
    : THEME_BG_COLORS.light;

  const themeContainer = isDarkMode
    ? amoledMode
      ? styles.bgAmoled
      : styles.bgDark
    : styles.bgLight;

  const cardStyle = isDarkMode
    ? amoledMode
      ? styles.cardAmoled
      : styles.cardDark
    : styles.cardLight;

  const inputStyle = isDarkMode
    ? amoledMode
      ? styles.inputAmoled
      : styles.inputDark
    : styles.inputLight;

  const themeText = isDarkMode ? styles.textDark : styles.textLight;

  const fabStyle = styles.standardFab;

  const fabIconColor = '#ffffff';

  const handleEditCard = useCallback((card) => {
    setEditingCardId(card.id);
    setNewName(card.name);
    setDetectedCode(card.code);
    setDetectedType(card.codeType || 'CODE128');
    setSelectedColor(card.color || '#3182CE');
    setCustomPickerOpen(false);
    setCurrentScreen('add_card');
  }, []);

  const saveNewCard = () => {
    if (!newName.trim()) {
      showAlert(t.alertWarning, t.alertNameReq);
      return;
    }

    if (!detectedCode) {
      showAlert(t.alertWarning, t.alertCodeReq);
      return;
    }

    const finalCode = detectedCode;

    // Ugyanaz a kód nem szerepelhet két kártyán (szerkesztéskor a saját
    // kártyánkat természetesen nem számítjuk duplikátumnak).
    const duplicateCard = cards.find(
      (c) =>
        c.id !== editingCardId &&
        String(c.code).trim() === String(finalCode).trim()
    );
    if (duplicateCard) {
      showAlert(
        t.alertWarning,
        `${t.alertCodeExists} ${duplicateCard.name}`
      );
      return;
    }

    if (editingCardId) {
      setCards((prevCards) =>
        prevCards.map((c) =>
          c.id === editingCardId
            ? {
                ...c,
                name: newName.trim(),
                code: String(finalCode),
                codeType: detectedType,
                color: selectedColor,
              }
            : c
        )
      );
    } else {
      const newCard = {
        id: Date.now().toString(),
        name: newName.trim(),
        code: String(finalCode),
        codeType: detectedType,
        color: selectedColor,
        linkedAppPackage: null,
        linkedAppIcon: null,
      };

      // A sheet előbb becsukódik, és csak utána kerül be az új kártya
      // (és indul el a hozzáadási animáció), hogy az ne a sheet mögött
      // fusson le. Az új kártya nem lesz automatikusan aktív.
      setTimeout(() => {
        setCards((prevCards) => [...prevCards, newCard]);
        setSwipedCardId(null);
        setFlippedCardId(null);
        setIsExpanded(false);
        setNewCardId(newCard.id);
        // az animáció lefutása után töröljük, hogy később (pl. keresés
        // után újra megjelenő kártyánál) ne játsszon le újra
        setTimeout(() => setNewCardId(null), 700);
      }, SHEET_CLOSE_DURATION);
    }

    if (editingCardId) {
      setSwipedCardId(null);
      setFlippedCardId(null);
      setIsExpanded(false);
    }

    setEditingCardId(null);
    setNewName('');
    setDetectedCode('');
    setDetectedType('CODE128');
    setSelectedColor('#3182CE');
    setCustomPickerOpen(false);
    setCurrentScreen('home');
  };

  const cancelAddCard = () => {
    setEditingCardId(null);
    setNewName('');
    setDetectedCode('');
    setDetectedType('CODE128');
    setSelectedColor('#3182CE');
    setCustomPickerOpen(false);
    setCurrentScreen('home');
  };

  const scrollToCard = useCallback((index) => {
    const targetScrollY = index * (CARD_HEIGHT + EXPANDED_GAP);
    setTimeout(() => {
      scrollViewRef.current?.scrollTo({
        y: targetScrollY,
        animated: true,
      });
    }, 50);
  }, []);

  const handleSwipeCard = useCallback((cardId) => {
    setSwipedCardId(cardId);
    
    if (cardId !== null) {
      const cardIndex = cards.findIndex((c) => c.id === cardId);
      if (cardIndex !== -1) {
        scrollToCard(cardIndex);
      }
    }
  }, [cards, scrollToCard]);

  const selectCard = useCallback((cardId) => {
    setIsSearchVisible((prevSearchVisible) => {
      if (prevSearchVisible) {
        Animated.timing(searchHeaderAnim, {
          toValue: 0,
          duration: 180,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }).start();
        setSearchQuery('');
      }
      return false;
    });
    setSwipedCardId(null);
    setIsExpanded((prevExpanded) => {
      if (prevExpanded) {
        setActiveCardId(cardId);
        return false;
      } else {
        setActiveCardId((prevActive) => (prevActive === cardId ? null : cardId));
        return prevExpanded;
      }
    });
  }, []);

  const toggleFavoriteCard = useCallback((cardId) => {
    setCards((prevCards) => {
      const idx = prevCards.findIndex((c) => c.id === cardId);
      if (idx === -1) return prevCards;
      const wasFavorite = !!prevCards[idx].favorite;

      if (!wasFavorite) {
        // Frissen bekedvencelve -> ugorjon a lista tetejére,
        // de jegyezzük meg az eredeti helyét, hogy oda tudjon visszaugrani
        const updatedCard = {
          ...prevCards[idx],
          favorite: true,
          _prevIndex: idx,
        };
        const rest = prevCards.filter((c) => c.id !== cardId);
        return [updatedCard, ...rest];
      }

      // Kedvenc visszavonása -> ugorjon vissza az eredeti helyére
      const { _prevIndex, ...cardWithoutMeta } = prevCards[idx];
      const updatedCard = { ...cardWithoutMeta, favorite: false };
      const rest = prevCards.filter((c) => c.id !== cardId);
      const originalIndex = typeof _prevIndex === 'number' ? _prevIndex : idx;
      const insertAt = Math.max(0, Math.min(originalIndex, rest.length));

      const newCards = [...rest];
      newCards.splice(insertAt, 0, updatedCard);
      return newCards;
    });
  }, []);


  const resetSelection = () => {
    setActiveCardId(null);
    setSwipedCardId(null);
    setFlippedCardId(null);
    setIsExpanded(false);
  };

  const deleteCard = useCallback((card) => {
    showAlert(
      t.deleteTitle,
      t.deleteConfirm.replace('{name}', card.name),
      [
        { text: t.cancel, style: 'cancel' },
        {
          text: t.deleteBtn,
          style: 'destructive',
          // Először lefut a kártya kirepülő animációja, a tényleges
          // törlés a finalizeDeleteCard-ban történik.
          onPress: () => setDeletingCardId(card.id),
        },
      ]
    );
  }, [t]);

  const finalizeDeleteCard = useCallback((cardId) => {
    setCards((prevCards) => prevCards.filter((item) => item.id !== cardId));
    setActiveCardId((prev) => (prev === cardId ? null : prev));
    setSwipedCardId((prev) => (prev === cardId ? null : prev));
    setFlippedCardId((prev) => (prev === cardId ? null : prev));
    setDeletingCardId((prev) => (prev === cardId ? null : prev));
  }, []);

  const openLinkedApp = useCallback((packageName) => {
    try {
      if (Platform.OS === 'android') {
        RNLauncherKitHelper.launchApplication(packageName);
      }
    } catch (e) {
      console.error('Hiba az alkalmazás megnyitásakor', e);
      showAlert(t.alertWarning, 'Nem sikerült megnyitni a társított alkalmazást.');
    }
  }, [t]);

  const openAppSelector = useCallback(async (card) => {
    setTargetCardForLink(card);
    setAppSearchQuery('');
    setInstalledAppsList([]);
    setIsAppModalVisible(true);
    setIsLoadingApps(true);

    try {
      if (Platform.OS === 'android') {
        const apps = await InstalledApps.getSortedApps({
          includeVersion: false,
          includeAccentColor: false,
        });
        setInstalledAppsList(Array.isArray(apps) ? apps : []);
      } else {
        setInstalledAppsList([]);
      }
    } catch (e) {
      console.error('Hiba az alkalmazások betöltésekor', e);
      setInstalledAppsList([]);
    } finally {
      setIsLoadingApps(false);
    }
  }, []);

  const selectAppForCard = (app) => {
    if (!targetCardForLink) return;

    setCards((prevCards) =>
      prevCards.map((c) =>
        c.id === targetCardForLink.id
          ? {
              ...c,
              linkedAppPackage: app.packageName,
              linkedAppIcon: app.icon,
              linkedAppLabel: app.label,
            }
          : c
      )
    );

    setIsAppModalVisible(false);
    setTargetCardForLink(null);
  };

  const unlinkAppFromCard = () => {
    if (!targetCardForLink) return;

    setCards((prevCards) =>
      prevCards.map((c) =>
        c.id === targetCardForLink.id
          ? {
              ...c,
              linkedAppPackage: null,
              linkedAppIcon: null,
              linkedAppLabel: null,
            }
          : c
      )
    );

    setIsAppModalVisible(false);
    setTargetCardForLink(null);
  };

  const filteredApps = installedAppsList.filter((app) =>
    app.label.toLowerCase().includes(appSearchQuery.toLowerCase())
  );

  const activeIndex = filteredCards.findIndex((item) => item.id === activeCardId);
  // Becsukott listában a kártyák helye. Egy csoporton belül (kedvencek /
  // nem kedvencek) a kártyák egymásra csúsznak (VISIBLE_HEADER lépésközzel), de
  // a csoportok között, és a kinyitott kártya alatt egy teljes kártyányi hely
  // marad, így nem kedvenc kártya soha nem csúszik kedvencre.
  const FULL_STEP = CARD_HEIGHT + EXTRA_GAP;
  const getCardGroup = (card) =>
    nearbyCard && card.id === nearbyCard.id && !card.favorite ? 0 : card.favorite ? 1 : 2;
  const collapsedOffsets = [];
  let groupOnlyBottomY = 0; // az aktív kártya nélküli (csak csoport-szóközös) elrendezés alja
  {
    let y = 0;
    let yGroupOnly = 0;
    filteredCards.forEach((card, i) => {
      if (i > 0) {
        const groupBreak = getCardGroup(filteredCards[i - 1]) !== getCardGroup(card);
        yGroupOnly += groupBreak ? FULL_STEP : VISIBLE_HEADER;
        y += groupBreak || i - 1 === activeIndex ? FULL_STEP : VISIBLE_HEADER;
      }
      collapsedOffsets.push(y);
      groupOnlyBottomY = yGroupOnly;
    });
  }
  const hasSeparatedGroups =
    filteredCards.length > 1 &&
    filteredCards.some((c, i) => i > 0 && getCardGroup(filteredCards[i - 1]) !== getCardGroup(c));
  const hasActiveCard = activeCardId !== null;
  const isFabHidden = hasActiveCard || isSearchVisible;

  useEffect(() => {
    Animated.timing(fabAnim, {
      toValue: isFabHidden ? 0 : 1,
      duration: isFabHidden ? 260 : 420,
      easing: isFabHidden
        ? Easing.in(Easing.cubic)
        : Easing.out(Easing.back(1.1)),
      useNativeDriver: true,
    }).start();
  }, [isFabHidden]);

  useEffect(() => {
    let isActive = true;

    const applyBrightness = async () => {
      try {
        if (brightnessBoostEnabled && hasActiveCard) {
          if (previousBrightnessRef.current === null) {
            previousBrightnessRef.current = await Brightness.getBrightnessAsync();
          }
          const targetBrightness =
            BRIGHTNESS_BOOST_LEVELS[brightnessBoostLevel] ?? 1;
          await Brightness.setBrightnessAsync(targetBrightness);
        } else if (previousBrightnessRef.current !== null) {
          const restoreTo = previousBrightnessRef.current;
          previousBrightnessRef.current = null;
          await Brightness.setBrightnessAsync(restoreTo);
        }
      } catch (e) {
        console.error('Nem sikerült módosítani a fényerőt:', e);
      }
    };

    if (isActive) applyBrightness();

    return () => {
      isActive = false;
    };
  }, [hasActiveCard, brightnessBoostEnabled, brightnessBoostLevel]);

  const isListScrollMode =
    isExpanded || swipedCardId !== null || flippedCardId !== null;
  const containerHeight = isListScrollMode
    ? filteredCards.length * (CARD_HEIGHT + EXPANDED_GAP) + 60
    : groupOnlyBottomY + CARD_HEIGHT + EXTRA_GAP + 50;

  // Akkor görgethető a lista, ha kibontott módban az utolsó kártya alja
  // (a + gomb miatti alsó hellyel együtt) nem fér bele a látható területbe.
  const expandedCardsBottom = Math.max(
    filteredCards.length * (CARD_HEIGHT + EXPANDED_GAP) - EXPANDED_GAP,
    0
  );
  const listOverflows =
    listViewportHeight > 0 &&
    expandedCardsBottom + LIST_CHROME_HEIGHT > listViewportHeight + 1;
  // Ha a felső kártya miatt a becsukott lista is hosszabb a képernyőnél, görgethető legyen.
  const collapsedOverflows =
    !isListScrollMode &&
    hasSeparatedGroups &&
    listViewportHeight > 0 &&
    containerHeight + LIST_CHROME_HEIGHT > listViewportHeight + 1;
  const listScrollEnabled = (isListScrollMode && listOverflows) || collapsedOverflows;

  // Az érintés-elkapó réteg kitölti a teljes látható területet (hogy az üres
  // részre koppintva megszűnjön a kijelölés), de ha minden elfér, a tartalom
  // pontosan akkora, mint a nézet, így nincs mit görgetni.
  const viewportStackHeight =
    listViewportHeight > 0
      ? Math.max(listViewportHeight - LIST_CHROME_HEIGHT, 0)
      : SCREEN_HEIGHT;
  const tapCatcherMinHeight =
    isListScrollMode && !listOverflows
      ? viewportStackHeight
      : Math.max(containerHeight, viewportStackHeight);

  if (!isAuthenticated) {
    return (
      <View style={[styles.lockScreenContainer, themeContainer]}>
        <StatusBar
          barStyle={isDarkMode ? 'light-content' : 'dark-content'}
          backgroundColor="transparent"
          translucent={true}
        />
        <View style={styles.lockIconWrap}>
          <Lock size={48} color={isDarkMode ? '#93c5fd' : '#2563eb'} strokeWidth={2} />
        </View>
        {isCheckingAuth ? (
          <ActivityIndicator
            size="large"
            color={isDarkMode ? '#93c5fd' : '#2563eb'}
            style={{ marginTop: 20 }}
          />
        ) : (
          <TouchableOpacity
            style={styles.lockUnlockBtn}
            activeOpacity={0.85}
            onPress={authenticate}
          >
            <Fingerprint size={20} color="#ffffff" />
            <Text style={styles.lockUnlockBtnText}>{t.lockScreenUnlockBtn}</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  if (currentScreen === 'scan_barcode') {
    // Alulról becsúszó keret – a kamera és a beolvasás tartalma változatlan.
    const wrapScan = (content) => (
      <View style={[{ flex: 1 }, themeContainer]}>
        <Animated.View
          style={{ flex: 1, transform: [{ translateY: scanSlideAnim }] }}
        >
          {content}
        </Animated.View>
      </View>
    );

    if (!permission) {
      return wrapScan(
        <View style={styles.centeredView}>
          <ActivityIndicator size="large" color="#2563eb" />
        </View>
      );
    }

    if (!permission.granted) {
      return wrapScan(
        <View style={styles.centeredView}>
          <Text style={{ color: '#fff', marginBottom: 20, textAlign: 'center' }}>
            {t.camPermissionDenied}
          </Text>
          <TouchableOpacity 
            style={{ backgroundColor: '#2563eb', padding: 12, borderRadius: 8 }}
            onPress={requestPermission}
          >
            <Text style={{ color: '#fff', fontWeight: 'bold' }}>Engedély megadása</Text>
          </TouchableOpacity>
        </View>
      );
    }

    return wrapScan(
      <View style={styles.cameraContainer}>
        <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />
        
        {isCameraReady && (
          <CameraView
            style={styles.fullScreenCamera}
            facing="back"
            barcodeScannerSettings={{
              barcodeTypes: BARCODE_SCAN_TYPES,
            }}
            onBarcodeScanned={scanned ? undefined : handleBarcodeScanned}
          />
        )}

        <View style={styles.cameraOverlayWrapper} pointerEvents="box-none">
          <TouchableOpacity
            style={styles.closeCameraButton}
            onPress={() => {
              setIsCameraReady(false);
              setScanned(false);
              hasScannedRef.current = false;
              setCurrentScreen(scanMode === 'backup_import' ? 'home' : 'add_card');
            }}
          >
            <X size={24} color="#ffffff" strokeWidth={2.5} />
          </TouchableOpacity>

          <View
            style={[
              styles.scanTargetBox,
              scanMode === 'backup_import' && styles.scanTargetBoxSquare,
            ]}
            pointerEvents="none"
          />

          <Text style={styles.scanInstructionText} pointerEvents="none">
            {scanMode === 'backup_import' ? t.backupScanInstruction : t.scanInstruction}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, themeContainer]}>
      <StatusBar
        barStyle={isDarkMode ? 'light-content' : 'dark-content'}
        backgroundColor="transparent"
        translucent={true}
      />

      <CustomAlert
        visible={alertConfig.visible}
        title={alertConfig.title}
        message={alertConfig.message}
        buttons={alertConfig.buttons}
        footerLink={alertConfig.footerLink}
        onClose={hideAlert}
        isDarkMode={isDarkMode}
        amoledMode={amoledMode}
      />

      <WelcomeModal
        visible={welcomeVisible}
        onClose={closeWelcome}
        onShown={markWelcomeSeen}
        t={t}
        isDarkMode={isDarkMode}
        amoledMode={amoledMode}
      />

      {isSearchVisible ? (
        <Animated.View
          style={[
            styles.headerRow,
            styles.searchHeaderRow,
            {
              opacity: searchHeaderAnim,
              transform: [
                {
                  translateY: searchHeaderAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [-12, 0],
                  }),
                },
              ],
            },
          ]}
        >
          <TouchableOpacity style={styles.backBtn} onPress={closeSearch}>
            <ArrowLeft
              size={26}
              color={isDarkMode ? '#ffffff' : '#0f172a'}
              strokeWidth={2.5}
            />
          </TouchableOpacity>
          <TextInput
            ref={searchInputRef}
            style={[styles.searchHeaderInput, themeText]}
            placeholder={t.searchCardsPlaceholder}
            placeholderTextColor={isDarkMode ? '#64748b' : '#94a3b8'}
            value={searchQuery}
            onChangeText={setSearchQuery}
            returnKeyType="search"
            autoCorrect={false}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity
              style={styles.searchClearBtn}
              onPress={() => setSearchQuery('')}
            >
              <X size={20} color={isDarkMode ? '#94a3b8' : '#64748b'} />
            </TouchableOpacity>
          )}
        </Animated.View>
      ) : (
        <TouchableWithoutFeedback onPress={resetSelection}>
          <Animated.View
            style={[
              styles.headerRow,
              {
                opacity: titleHeaderAnim,
                transform: [
                  {
                    translateY: titleHeaderAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [-40, 0],
                    }),
                  },
                ],
              },
            ]}
          >
            <Text style={[styles.title, themeText]}>
              {t.title.includes('Wallet') ? (
                <>
                  {t.title.split('Wallet')[0]}
                  <Text style={styles.titleWalletPart}>Wallet</Text>
                  {t.title.split('Wallet')[1]}
                </>
              ) : (
                t.title
              )}
            </Text>
            <View style={styles.headerActionsRow}>
              <TouchableOpacity
                style={styles.searchIconBtn}
                onPress={openSearch}
              >
                <Search
                  size={28}
                  color={isDarkMode ? '#ffffff' : '#0f172a'}
                  strokeWidth={2.2}
                />
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.settingsIconBtn}
                onPress={openSettings}
              >
                <Animated.View style={{ transform: [{ rotate: spinDegree }] }}>
                  <Settings
                    size={28}
                    color={isDarkMode ? '#ffffff' : '#0f172a'}
                    strokeWidth={2.2}
                  />
                </Animated.View>
              </TouchableOpacity>
            </View>
          </Animated.View>
        </TouchableWithoutFeedback>
      )}

      {cards.length === 0 ? (
        <TouchableWithoutFeedback onPress={resetSelection}>
          <View style={styles.emptyContainer}>
            <Text
              style={[
                styles.emptyText,
                isDarkMode ? styles.emptyTextDark : styles.emptyTextLight,
              ]}
            >
              {t.emptyTitle}
            </Text>
            <Text
              style={[
                styles.emptySubText,
                isDarkMode ? styles.emptyTextDark : styles.emptyTextLight,
              ]}
            >
              {t.emptySub}
            </Text>
          </View>
        </TouchableWithoutFeedback>
      ) : isSearchVisible && searchQuery.trim() && filteredCards.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text
            style={[
              styles.emptyText,
              isDarkMode ? styles.emptyTextDark : styles.emptyTextLight,
            ]}
          >
            {t.searchNoResults}
          </Text>
        </View>
      ) : (
        <View style={{ flex: 1 }}>
          <ScrollView
            ref={scrollViewRef}
            onLayout={(e) => setListViewportHeight(e.nativeEvent.layout.height)}
            onScroll={handleListScroll}
            scrollEventThrottle={16}
            showsVerticalScrollIndicator={false}
            scrollEnabled={listScrollEnabled}
            alwaysBounceVertical={false}
            contentContainerStyle={{
              paddingBottom: LIST_PADDING_BOTTOM,
              paddingTop: LIST_PADDING_TOP,
              flexGrow: 1,
            }}
          >
            <TouchableWithoutFeedback onPress={resetSelection}>
              <View
                style={[
                  styles.stackContainer,
                  {
                    minHeight: tapCatcherMinHeight,
                  },
                ]}
              >
                {filteredCards.map((card, index) => (
                  <AnimatedCardItem
                    key={card.id}
                    card={card}
                    index={index}
                    collapsedY={collapsedOffsets[index]}
                    hasActiveCard={hasActiveCard}
                    hideCodes={hideCodes}
                    activeCardId={activeCardId}
                    isExpanded={isExpanded}
                    setIsExpanded={setIsExpanded}
                    flippedCardId={flippedCardId}
                    setFlippedCardId={setFlippedCardId}
                    swipeToDeleteEnabled={swipeToDeleteEnabled}
                    swipeToLinkEnabled={swipeToLinkEnabled}
                    swipedCardId={swipedCardId}
                    setSwipedCardId={handleSwipeCard}
                    onSelect={selectCard}
                    onDelete={deleteCard}
                    isDeleting={deletingCardId === card.id}
                    isNewlyAdded={newCardId === card.id}
                    onDeleteAnimationEnd={finalizeDeleteCard}
                    onOpenAppSelector={openAppSelector}
                    onOpenLinkedApp={openLinkedApp}
                    onEditCard={handleEditCard}
                    onScrollToCard={scrollToCard}
                    onToggleFavorite={toggleFavoriteCard}
                    isReorderMode={isReorderMode}
                    reorderReferenceIndex={reorderReferenceIndex}
                    dragCardId={dragCardId}
                    dragOriginIndex={dragOriginIndex}
                    dragHoverIndex={dragHoverIndex}
                    onDragStart={handleDragStart}
                    onDragMove={handleDragMove}
                    onDragEnd={handleDragEnd}
                    t={t}
                  />
                ))}
              </View>
            </TouchableWithoutFeedback>
          </ScrollView>
          <HeaderFade color={themeBgColor} scrollY={listScrollY} />
        </View>
      )}

      <AnimatedTouchableOpacity
        style={[
          fabStyle,
          {
            transform: [
              {
                translateX: fabAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [120, 0],
                }),
              },
            ],
          },
        ]}
        activeOpacity={0.8}
        pointerEvents={isFabHidden ? 'none' : 'auto'}
        onPress={() => {
          setEditingCardId(null);
          setNewName('');
          setDetectedCode('');
          setDetectedType('CODE128');
          setSelectedColor('#3182CE');
          setCustomPickerOpen(false);
          setCurrentScreen('add_card');
        }}
      >
        <Plus size={28} color={fabIconColor} strokeWidth={2.5} />
      </AnimatedTouchableOpacity>

      {/* MODAL: Alkalmazások Listája */}
      <Modal
        visible={isAppModalVisible}
        animationType="slide"
        transparent={true}
        statusBarTranslucent={true}
        onRequestClose={() => setIsAppModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <Pressable
            style={styles.modalBackdrop}
            onPress={() => setIsAppModalVisible(false)}
          />

          <View style={[styles.bottomSheetContainer, themeContainer, { height: '80%' }]}>
            <View style={styles.sheetHeaderRow}>
              <Text style={[styles.title, themeText, { fontSize: 20 }]}>
                {t.selectAppTitle}
              </Text>
              <TouchableOpacity onPress={() => setIsAppModalVisible(false)}>
                <X size={24} color={isDarkMode ? '#ffffff' : '#0f172a'} />
              </TouchableOpacity>
            </View>

            <TextInput
              style={[styles.inputStandard, inputStyle, { marginBottom: 15 }]}
              placeholder={t.searchAppPlaceholder}
              placeholderTextColor={isDarkMode ? '#94a3b8' : '#64748b'}
              value={appSearchQuery}
              onChangeText={setAppSearchQuery}
            />

            <TouchableOpacity
              style={[styles.appListItem, cardStyle, { marginBottom: 10 }]}
              activeOpacity={0.7}
              onPress={unlinkAppFromCard}
            >
              <Ban size={32} color={isDarkMode ? '#94a3b8' : '#64748b'} style={{ marginRight: 12 }} />
              <Text style={[styles.appNameText, themeText]} numberOfLines={1}>
                {t.noAppLinked}
              </Text>
            </TouchableOpacity>

            {isLoadingApps ? (
              <View style={styles.appListLoadingWrap}>
                <ActivityIndicator size="large" color={isDarkMode ? '#93c5fd' : '#2563eb'} />
                <Text style={[styles.appListLoadingText, themeText]}>
                  {t.loadingApps}
                </Text>
              </View>
            ) : (
              <FlatList
                data={filteredApps}
                keyExtractor={(item) => item.packageName}
                initialNumToRender={16}
                maxToRenderPerBatch={16}
                windowSize={7}
                removeClippedSubviews={Platform.OS === 'android'}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={[styles.appListItem, cardStyle]}
                    activeOpacity={0.7}
                    onPress={() => selectAppForCard(item)}
                  >
                    {item.icon ? (
                      <Image
                        source={{ uri: item.icon }}
                        style={styles.appListIcon}
                      />
                    ) : (
                      <AppWindow size={32} color={isDarkMode ? '#ffffff' : '#0f172a'} style={{ marginRight: 12 }} />
                    )}
                    <Text style={[styles.appNameText, themeText]} numberOfLines={1}>
                      {item.label}
                    </Text>
                  </TouchableOpacity>
                )}
              />
            )}
          </View>
        </View>
      </Modal>

      {/* Új / Szerkesztett Kártya Modal */}
      <Modal
        visible={currentScreen === 'add_card'}
        animationType="slide"
        transparent={true}
        hardwareAccelerated={true}
        statusBarTranslucent={true}
        onRequestClose={cancelAddCard}
      >
        <View
          ref={addSheetOverlayRef}
          style={styles.modalOverlay}
          onLayout={(e) => setAddSheetAreaHeight(e.nativeEvent.layout.height)}
        >
          <Pressable style={styles.modalBackdrop} onPress={cancelAddCard} />

          {/* Külső réteg: a JS-vezérelt elrendezés-animációk (billentyűzet
              miatti felcsúszás, max. magasság). A belső réteg a natív
              animációt (húzás) kapja — a kettő nem keverhető egy nézeten. */}
          <Animated.View
            style={{
              marginBottom: keyboardShiftAnim,
              maxHeight: addSheetMaxHeightAnim,
            }}
          >
          <Animated.View
            style={[
              styles.bottomSheetContainer,
              themeContainer,
              {
                maxHeight: SCREEN_HEIGHT * 2,
                flexShrink: 1,
                transform: [
                  { translateY: modalPanY },
                  { translateY: sheetShiftAnim },
                ],
              },
            ]}
            onLayout={(e) => {
              sheetHeightRef.current = e.nativeEvent.layout.height;
            }}
          >
            {/* „Szoknya": a sheet háttere a képernyő aljáig kitölti a rést,
                amikor a sheet záráskor átmenetileg följebb áll. */}
            <View
              pointerEvents="none"
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                top: '100%',
                height: SCREEN_HEIGHT,
                backgroundColor: themeBgColor,
              }}
            />
            <View {...modalPanResponder.panHandlers} style={styles.dragArea}>
              <View style={styles.dragHandle} />
              <View style={styles.sheetHeaderRow}>
                <Text style={[styles.title, themeText]}>
                  {editingCardId ? t.editCard : t.newCard}
                </Text>
              </View>
            </View>

            <ScrollView
              ref={addSheetScrollRef}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              onLayout={(e) => {
                scrollViewHRef.current = e.nativeEvent.layout.height;
              }}
              onContentSizeChange={(w, h) => {
                scrollContentHRef.current = h;
              }}
            >
              <Text style={[styles.fieldLabel, themeText]}>{t.storeName}</Text>
              <TextInput
                style={[styles.inputStandard, inputStyle]}
                placeholder={t.storePlaceholder}
                placeholderTextColor={isDarkMode ? '#94a3b8' : '#64748b'}
                value={newName}
                onChangeText={setNewName}
              />

              <Text style={[styles.fieldLabel, themeText, { marginTop: 15 }]}>
                {t.addCode}
              </Text>
              <View style={styles.scanOptionsRow}>
                <TouchableOpacity
                  style={{ flex: 1 }}
                  onPress={startScanning}
                >
                  <View style={[styles.scanCardInner, cardStyle]}>
                    <Camera
                      size={32}
                      color={isDarkMode ? '#ffffff' : '#0f172a'}
                      strokeWidth={2}
                    />
                    <Text style={[styles.scanOptionTitle, themeText]}>
                      {t.scan}
                    </Text>
                    <Text style={styles.scanOptionSub}>{t.scanSub}</Text>
                  </View>
                </TouchableOpacity>

                <TouchableOpacity
                  style={{ flex: 1 }}
                  onPress={pickImageAndScanBarcode}
                >
                  <View style={[styles.scanCardInner, cardStyle]}>
                    <ImageIcon
                      size={32}
                      color={isDarkMode ? '#ffffff' : '#0f172a'}
                      strokeWidth={2}
                    />
                    <Text style={[styles.scanOptionTitle, themeText]}>
                      {t.screenshot}
                    </Text>
                    <Text style={styles.scanOptionSub}>{t.screenshotSub}</Text>
                  </View>
                </TouchableOpacity>
              </View>

              {detectedCode !== '' && (
                <View style={styles.successBadge}>
                  <Text style={styles.successBadgeText}>
                    ✓ {t.codeSaved} {detectedCode}
                  </Text>
                  <Text style={styles.detectedTypeDebugText}>
                    {t.detectedFormatLabel}{' '}
                    {isQrCodeType(detectedType) ? 'QR' : mapBarcodeFormat(detectedType, detectedCode)}
                    {'  ('}{detectedType || '—'}{')'}
                  </Text>
                </View>
              )}

              {detectedCode !== '' && isQrCodeType(detectedType) && (
                <View style={[styles.barcodePreviewCard, cardStyle]}>
                  <Text style={[styles.fieldLabel, themeText]}>
                    {t.barcodePreview}
                  </Text>
                  <View style={styles.barcodePreviewInner}>
                    <QRCode
                      value={detectedCode}
                      size={90}
                      color="#000000"
                      backgroundColor="transparent"
                    />
                  </View>
                </View>
              )}

              {detectedCode !== '' && !isQrCodeType(detectedType) && mapBarcodeFormat(detectedType, detectedCode) && (
                <View style={[styles.barcodePreviewCard, cardStyle]}>
                  <Text style={[styles.fieldLabel, themeText]}>
                    {t.barcodePreview}
                  </Text>
                  <View style={styles.barcodePreviewInner}>
                    <Barcode
                      value={detectedCode}
                      format={mapBarcodeFormat(detectedType, detectedCode)}
                      singleBarWidth={2}
                      height={50}
                      lineColor="#000000"
                      backgroundColor="transparent"
                      onError={() => {}}
                    />
                  </View>
                </View>
              )}

              <Text style={[styles.fieldLabel, themeText, { marginTop: 25 }]}>
                {t.cardColor}
              </Text>
              <View style={styles.palette}>
                {colorPalette.map((color, index) => (
                  <TouchableOpacity
                    key={index}
                    style={[
                      styles.colorCircle,
                      {
                        backgroundColor: color,
                        borderColor: isDarkMode ? '#ffffff' : '#0f172a',
                        borderWidth: selectedColor === color ? 3 : 0,
                      },
                    ]}
                    onPress={() => {
                      setSelectedColor(color);
                      setCustomPickerOpen(false);
                    }}
                  />
                ))}
                {(() => {
                  const isCustom = !colorPalette.some(
                    (c) => c.toLowerCase() === (selectedColor || '').toLowerCase()
                  );
                  const rgbNow = hexToRgb(selectedColor) || [49, 130, 206];
                  const lum =
                    (0.299 * rgbNow[0] + 0.587 * rgbNow[1] + 0.114 * rgbNow[2]) / 255;
                  const plusColor = isCustom
                    ? lum > 0.6
                      ? '#0f172a'
                      : '#ffffff'
                    : isDarkMode
                    ? '#ffffff'
                    : '#0f172a';
                  return (
                    <TouchableOpacity
                      style={[
                        styles.colorCircle,
                        {
                          alignItems: 'center',
                          justifyContent: 'center',
                          backgroundColor: isCustom
                            ? selectedColor
                            : isDarkMode
                            ? 'rgba(255,255,255,0.12)'
                            : 'rgba(15,23,42,0.08)',
                          borderColor: isDarkMode ? '#ffffff' : '#0f172a',
                          borderWidth: isCustom ? 3 : 0,
                        },
                      ]}
                      onPress={toggleCustomPicker}
                      accessibilityLabel={t.customColor}
                    >
                      <View style={{ width: 20, height: 20 }}>
                        <Animated.View
                          style={{
                            position: 'absolute',
                            opacity: customPanelProgress.interpolate({
                              inputRange: [0, 1],
                              outputRange: [1, 0],
                            }),
                            transform: [
                              {
                                rotate: customPanelProgress.interpolate({
                                  inputRange: [0, 1],
                                  outputRange: ['0deg', '90deg'],
                                }),
                              },
                            ],
                          }}
                        >
                          <Plus size={20} color={plusColor} strokeWidth={2.5} />
                        </Animated.View>
                        <Animated.View
                          style={{
                            position: 'absolute',
                            opacity: customPanelProgress,
                            transform: [
                              {
                                rotate: customPanelProgress.interpolate({
                                  inputRange: [0, 1],
                                  outputRange: ['-90deg', '0deg'],
                                }),
                              },
                            ],
                          }}
                        >
                          <Minus size={20} color={plusColor} strokeWidth={2.5} />
                        </Animated.View>
                      </View>
                    </TouchableOpacity>
                  );
                })()}
              </View>

              {(() => {
                const [r, g, b] = hexToRgb(selectedColor) || [49, 130, 206];
                const setRgb = (nr, ng, nb) => {
                  const hex = rgbToHex(nr, ng, nb);
                  setSelectedColor(hex);
                  setCustomHexText(hex);
                };
                return (
                  <View
                    pointerEvents={customPickerOpen ? 'auto' : 'none'}
                    style={{
                      height: customPickerOpen ? customPanelContentH || undefined : 0,
                      overflow: 'hidden',
                    }}
                    onLayout={(e) => {
                      customPanelYRef.current = e.nativeEvent.layout.y;
                    }}
                  >
                  <Animated.View
                    style={{
                      position: 'absolute',
                      left: 0,
                      right: 0,
                      top: 0,
                      paddingTop: 16,
                      opacity: customPanelProgress.interpolate({
                        inputRange: [0, 0.35, 1],
                        outputRange: [0, 0, 1],
                      }),
                      transform: [
                        {
                          translateY: customPanelProgress.interpolate({
                            inputRange: [0, 1],
                            outputRange: [-14, 0],
                          }),
                        },
                      ],
                    }}
                    onLayout={(e) =>
                      setCustomPanelContentH(e.nativeEvent.layout.height)
                    }
                  >
                    <Text style={[styles.fieldLabel, themeText]}>
                      {t.customColor}
                    </Text>
                    <View
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        marginTop: 8,
                        gap: 10,
                      }}
                    >
                      <View
                        style={{
                          flex: 1,
                          height: 50,
                          borderRadius: 12,
                          backgroundColor: selectedColor,
                        }}
                      />
                      <TextInput
                        style={[
                          styles.inputStandard,
                          inputStyle,
                          { width: 104, paddingHorizontal: 12, textAlign: 'center' },
                        ]}
                        value={customHexText}
                        placeholder="#RRGGBB"
                        placeholderTextColor={isDarkMode ? '#94a3b8' : '#64748b'}
                        autoCapitalize="characters"
                        autoCorrect={false}
                        maxLength={7}
                        onFocus={() => {
                          hexFocusedRef.current = true;
                          updateKeyboardOverlap();
                        }}
                        onBlur={() => {
                          hexFocusedRef.current = false;
                          animateKeyboardShift(0);
                        }}
                        onChangeText={(txt) => {
                          setCustomHexText(txt);
                          const rgb = hexToRgb(txt);
                          if (rgb) setSelectedColor(rgbToHex(...rgb));
                        }}
                      />
                    </View>
                    <ColorChannelSlider
                      label="R"
                      value={r}
                      tint="#ef4444"
                      isDark={isDarkMode}
                      onChange={(v) => setRgb(v, g, b)}
                    />
                    <ColorChannelSlider
                      label="G"
                      value={g}
                      tint="#22c55e"
                      isDark={isDarkMode}
                      onChange={(v) => setRgb(r, v, b)}
                    />
                    <ColorChannelSlider
                      label="B"
                      value={b}
                      tint="#3b82f6"
                      isDark={isDarkMode}
                      onChange={(v) => setRgb(r, g, v)}
                    />
                  </Animated.View>
                  </View>
                );
              })()}

              <View style={styles.actionButtonRow}>
                <TouchableOpacity style={{ flex: 1 }} onPress={cancelAddCard}>
                  <View style={styles.btnCancel}>
                    <Text style={styles.cancelText}>{t.cancel}</Text>
                  </View>
                </TouchableOpacity>

                <TouchableOpacity
                  style={{ flex: 2 }}
                  onPress={saveNewCard}
                  activeOpacity={0.8}
                >
                  <View
                    style={[
                      styles.btnSaveStandard,
                      isDarkMode ? styles.btnSaveDark : styles.btnSaveLight,
                    ]}
                  >
                    <Text
                      style={
                        isDarkMode ? styles.textSaveDark : styles.textSaveLight
                      }
                    >
                      {t.save}
                    </Text>
                  </View>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </Animated.View>
          </Animated.View>
        </View>
      </Modal>

      {/* Biztonsági mentés megosztása QR kóddal (az Új kártya sheet designjával) */}
      <Modal
        visible={isBackupQrVisible}
        animationType="slide"
        transparent={true}
        hardwareAccelerated={true}
        statusBarTranslucent={true}
        onRequestClose={() => setIsBackupQrVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <Pressable
            style={styles.modalBackdrop}
            onPress={() => setIsBackupQrVisible(false)}
          />

          <Animated.View
            style={[
              styles.bottomSheetContainer,
              themeContainer,
              { transform: [{ translateY: backupQrPanY }] },
            ]}
          >
            <View {...backupQrPanResponder.panHandlers} style={styles.dragArea}>
              <View style={styles.dragHandle} />
              <View style={styles.sheetHeaderRow}>
                <Text style={[styles.title, themeText]}>{t.backupQrTitle}</Text>
              </View>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={[styles.settingSub, { marginBottom: 20 }]}>
                {t.backupQrSubtitle}
              </Text>

              {isBackupQrVisible && (
                <View style={styles.backupQrBox}>
                  <QRCode
                    value={JSON.stringify(buildSharePayload())}
                    size={220}
                    color="#000000"
                    backgroundColor="#ffffff"
                  />
                </View>
              )}

              <TouchableOpacity
                style={{ marginTop: 25 }}
                activeOpacity={0.8}
                onPress={shareCardsFile}
              >
                <View
                  style={[
                    styles.btnSaveStandard,
                    isDarkMode ? styles.btnSaveDark : styles.btnSaveLight,
                  ]}
                >
                  <Text
                    style={
                      isDarkMode ? styles.textSaveDark : styles.textSaveLight
                    }
                  >
                    {t.backupShareOtherBtn}
                  </Text>
                </View>
              </TouchableOpacity>

              <TouchableOpacity
                style={{ marginTop: 12, marginBottom: 20 }}
                onPress={() => setIsBackupQrVisible(false)}
              >
                <View style={styles.btnCancel}>
                  <Text style={styles.cancelText}>{t.cancel}</Text>
                </View>
              </TouchableOpacity>
            </ScrollView>
          </Animated.View>
        </View>
      </Modal>

      {/* Beállítások Panel */}
      {isSettingsVisible && (
        <Animated.View
          style={[
            styles.settingsOverlayPanel,
            themeContainer,
            { transform: [{ translateX: settingsSlideAnim }] },
          ]}
        >
          <View style={styles.screenHeader}>
            <TouchableOpacity style={styles.backBtn} onPress={closeSettings}>
              <ArrowLeft
                size={28}
                color={isDarkMode ? '#ffffff' : '#0f172a'}
                strokeWidth={2.5}
              />
            </TouchableOpacity>
            <Text style={[styles.title, themeText]}>{t.settings}</Text>
            <TouchableOpacity
              style={styles.settingsIconBtn}
              onPress={startBackupQrScan}
              accessibilityLabel="Scan"
            >
              <ScanLine
                size={26}
                color={isDarkMode ? '#ffffff' : '#0f172a'}
                strokeWidth={2.5}
              />
            </TouchableOpacity>
          </View>

          <View style={{ flex: 1 }}>
            <ScrollView
              style={{ paddingHorizontal: 20 }}
              contentContainerStyle={{ paddingBottom: 40 }}
              nestedScrollEnabled={true}
              onScroll={handleSettingsScroll}
              scrollEventThrottle={16}
              keyboardShouldPersistTaps="handled"
            >
              <Text style={[styles.sectionHeader, themeText]}>{t.language}</Text>

              <View
                style={styles.dropdownContainer}
                onLayout={(e) => {
                  const { y, height } = e.nativeEvent.layout;
                  setLangRowLayout({ y, height });
                }}
              >
                <TouchableOpacity
                  activeOpacity={0.8}
                  onPress={() => {
                    setLangDropdownOpen(!langDropdownOpen);
                    setThemeDropdownOpen(false);
                  }}
                >
                  <View
                    style={[
                      styles.settingRow,
                      cardStyle,
                      langDropdownOpen && styles.settingRowOpen,
                    ]}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.settingTitle, themeText]}>{t.language}</Text>
                      <Text style={styles.settingSub}>{currentLangLabel}</Text>
                    </View>
                    <Animated.View style={{ transform: [{ rotate: langChevronRotate }] }}>
                      <ChevronDown
                        size={20}
                        color={isDarkMode ? '#94a3b8' : '#64748b'}
                        strokeWidth={2.5}
                      />
                    </Animated.View>
                  </View>
                </TouchableOpacity>

              </View>

              <Text style={[styles.sectionHeader, themeText, { marginTop: 25 }]}>
                {t.appearance}
              </Text>

              <View
                style={styles.dropdownContainer}
                onLayout={(e) => {
                  const { y, height } = e.nativeEvent.layout;
                  setThemeRowLayout({ y, height });
                }}
              >
                <TouchableOpacity
                  activeOpacity={0.8}
                  onPress={() => {
                    setThemeDropdownOpen(!themeDropdownOpen);
                    setLangDropdownOpen(false);
                  }}
                >
                  <View
                    style={[
                      styles.settingRow,
                      cardStyle,
                      themeDropdownOpen && styles.settingRowOpen,
                    ]}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.settingTitle, themeText]}>{t.theme}</Text>
                      <Text style={styles.settingSub}>
                        {themeMode === 'system'
                          ? t.themeSystem
                          : themeMode === 'light'
                          ? t.themeLight
                          : t.themeDark}
                      </Text>
                    </View>
                    <Animated.View style={{ transform: [{ rotate: themeChevronRotate }] }}>
                      <ChevronDown
                        size={20}
                        color={isDarkMode ? '#94a3b8' : '#64748b'}
                        strokeWidth={2.5}
                      />
                    </Animated.View>
                  </View>
                </TouchableOpacity>

              </View>

              {isDarkMode && (
                <View style={[styles.settingRow, cardStyle, { marginTop: 12 }]}>
                  <View style={styles.backupIconWrap}>
                    <Moon
                      size={20}
                      color={isDarkMode ? '#ffffff' : '#000000'}
                      strokeWidth={2.5}
                    />
                  </View>
                  <View style={{ flex: 1, paddingRight: 10 }}>
                    <Text style={[styles.settingTitle, themeText]}>{t.amoled}</Text>
                    <Text style={styles.settingSub}>{t.amoledSub}</Text>
                  </View>
                  <SquareSwitch
                    value={amoledMode}
                    onValueChange={setAmoledMode}
                  />
                </View>
              )}

              <Text style={[styles.sectionHeader, themeText, { marginTop: 25 }]}>
                {t.advanced}
              </Text>

              <View style={[styles.settingRow, cardStyle]}>
                <View style={styles.backupIconWrap}>
                  <Trash2
                    size={20}
                    color={isDarkMode ? '#ffffff' : '#000000'}
                    strokeWidth={2.5}
                  />
                </View>
                <View style={{ flex: 1, paddingRight: 10 }}>
                  <Text style={[styles.settingTitle, themeText]}>{t.swipeDelete}</Text>
                  <Text style={styles.settingSub}>{t.swipeDeleteSub}</Text>
                </View>
                <SquareSwitch
                  value={swipeToDeleteEnabled}
                  onValueChange={setSwipeToDeleteEnabled}
                />
              </View>

              <View style={[styles.settingRow, cardStyle, { marginTop: 12 }]}>
                <View style={styles.backupIconWrap}>
                  <Link2
                    size={20}
                    color={isDarkMode ? '#ffffff' : '#000000'}
                    strokeWidth={2.5}
                  />
                </View>
                <View style={{ flex: 1, paddingRight: 10 }}>
                  <Text style={[styles.settingTitle, themeText]}>{t.swipeLink}</Text>
                  <Text style={styles.settingSub}>{t.swipeLinkSub}</Text>
                </View>
                <SquareSwitch
                  value={swipeToLinkEnabled}
                  onValueChange={setSwipeToLinkEnabled}
                />
              </View>

              <View style={[styles.settingRow, cardStyle, { marginTop: 12 }]}>
                <View style={styles.backupIconWrap}>
                  <EyeOff
                    size={20}
                    color={isDarkMode ? '#ffffff' : '#000000'}
                    strokeWidth={2.5}
                  />
                </View>
                <View style={{ flex: 1, paddingRight: 10 }}>
                  <Text style={[styles.settingTitle, themeText]}>{t.hideCodes}</Text>
                  <Text style={styles.settingSub}>{t.hideCodesSub}</Text>
                </View>
                <SquareSwitch
                  value={hideCodes}
                  onValueChange={setHideCodes}
                />
              </View>

              <View style={[styles.settingRow, cardStyle, { marginTop: 12 }]}>
                <View style={styles.backupIconWrap}>
                  <MapPin
                    size={20}
                    color={isDarkMode ? '#ffffff' : '#000000'}
                    strokeWidth={2.5}
                  />
                </View>
                <View style={{ flex: 1, paddingRight: 10 }}>
                  <Text style={[styles.settingTitle, themeText]}>{t.nearbyCard}</Text>
                  <Text style={styles.settingSub}>{t.nearbyCardSub}</Text>
                </View>
                <SquareSwitch
                  value={nearbyCardEnabled}
                  onValueChange={handleToggleNearbyCard}
                />
              </View>

              <View style={[styles.settingRow, cardStyle, { marginTop: 12 }]}>
                <View style={styles.backupIconWrap}>
                  <Sun
                    size={20}
                    color={isDarkMode ? '#ffffff' : '#000000'}
                    strokeWidth={2.5}
                  />
                </View>
                <View style={{ flex: 1, paddingRight: 10 }}>
                  <Text style={[styles.settingTitle, themeText]}>{t.brightnessBoost}</Text>
                  <Text style={styles.settingSub}>{t.brightnessBoostSub}</Text>
                </View>
                <SquareSwitch
                  value={brightnessBoostEnabled}
                  onValueChange={setBrightnessBoostEnabled}
                />
              </View>

              {brightnessBoostEnabled && (
                <View style={[styles.settingRow, cardStyle, styles.brightnessLevelRow, { marginTop: 12 }]}>
                  <Text style={[styles.settingTitle, themeText, { marginBottom: 14 }]}>
                    {t.brightnessBoostLevelLabel}
                  </Text>

                  <PhaseSlider
                    value={brightnessBoostLevel}
                    onValueChange={setBrightnessBoostLevel}
                    phaseCount={3}
                    isDarkMode={isDarkMode}
                  />

                  <View style={styles.brightnessLevelLabelsRow}>
                    <Text style={[styles.settingSub, styles.brightnessLevelLabelLeft]}>
                      {t.brightnessLevelLow}
                    </Text>
                    <Text style={[styles.settingSub, styles.brightnessLevelLabelCenter]}>
                      {t.brightnessLevelMedium}
                    </Text>
                    <Text style={[styles.settingSub, styles.brightnessLevelLabelRight]}>
                      {t.brightnessLevelHigh}
                    </Text>
                  </View>
                </View>
              )}

              <Text style={[styles.sectionHeader, themeText, { marginTop: 25 }]}>
                {t.backupSection}
              </Text>

              <TouchableOpacity
                activeOpacity={0.8}
                onPress={downloadBackup}
              >
                <View style={[styles.settingRow, cardStyle]}>
                  <View style={styles.backupIconWrap}>
                    <Download
                      size={20}
                      color={isDarkMode ? '#ffffff' : '#000000'}
                      strokeWidth={2.5}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.settingTitle, themeText]}>
                      {t.backupDownload}
                    </Text>
                    <Text style={styles.settingSub}>{t.backupDownloadSub}</Text>
                  </View>
                </View>
              </TouchableOpacity>

              <TouchableOpacity
                activeOpacity={0.8}
                onPress={() => setIsBackupQrVisible(true)}
              >
                <View style={[styles.settingRow, cardStyle, { marginTop: 12 }]}>
                  <View style={styles.backupIconWrap}>
                    <Share2
                      size={20}
                      color={isDarkMode ? '#ffffff' : '#000000'}
                      strokeWidth={2.5}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.settingTitle, themeText]}>
                      {t.backupExport}
                    </Text>
                    <Text style={styles.settingSub}>{t.backupExportSub}</Text>
                  </View>
                </View>
              </TouchableOpacity>

              <TouchableOpacity
                activeOpacity={0.8}
                onPress={importBackup}
              >
                <View style={[styles.settingRow, cardStyle, { marginTop: 12 }]}>
                  <View style={styles.backupIconWrap}>
                    <Upload
                      size={20}
                      color={isDarkMode ? '#ffffff' : '#000000'}
                      strokeWidth={2.5}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.settingTitle, themeText]}>
                      {t.backupImport}
                    </Text>
                    <Text style={styles.settingSub}>{t.backupImportSub}</Text>
                  </View>
                </View>
              </TouchableOpacity>

              <Text style={[styles.sectionHeader, themeText, { marginTop: 25 }]}>
                {t.updateSection}
              </Text>

              <View style={[styles.settingRow, cardStyle]}>
                <View style={styles.backupIconWrap}>
                  <RefreshCw
                    size={20}
                    color={isDarkMode ? '#ffffff' : '#000000'}
                    strokeWidth={2.5}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.settingTitle, themeText]}>
                    {t.autoUpdateCheck}
                  </Text>
                  <Text style={styles.settingSub}>{t.autoUpdateCheckSub}</Text>
                </View>
                <SquareSwitch
                  value={autoUpdateCheckEnabled}
                  onValueChange={setAutoUpdateCheckEnabled}
                />
              </View>

              <TouchableOpacity
                activeOpacity={0.8}
                onPress={() => checkForUpdates(true)}
                disabled={isCheckingUpdate}
              >
                <View style={[styles.settingRow, cardStyle, { marginTop: 12 }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.settingTitle, themeText]}>
                      {t.checkUpdateNow}
                    </Text>
                    <Text style={styles.settingSub}>
                      {t.currentVersionLabel} {Application.nativeApplicationVersion || '—'}
                    </Text>
                  </View>
                  {isCheckingUpdate && (
                    <ActivityIndicator size="small" color={isDarkMode ? '#ffffff' : '#000000'} />
                  )}
                </View>
              </TouchableOpacity>

              <Text style={[styles.sectionHeader, themeText, { marginTop: 25 }]}>
                {t.developer}
              </Text>

              <View style={[styles.developerCard, cardStyle, { marginBottom: 20 }]}>
                <View style={styles.developerInfo}>
                  <Text style={styles.developerSub}>{t.developedBy}</Text>
                  <Text style={[styles.developerName, themeText]}>akosdevhu</Text>
                </View>
                <View style={styles.developerSocialColumn}>
                  <TouchableOpacity
                    activeOpacity={0.6}
                    onPress={() => handleOpenDeveloperURL(DEVELOPER_GITHUB_URL)}
                  >
                    <Text style={styles.developerSocialLink}>GitHub</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    activeOpacity={0.6}
                    onPress={() => handleOpenDeveloperURL(DEVELOPER_INSTAGRAM_URL)}
                  >
                    <Text style={styles.developerSocialLink}>Instagram</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    activeOpacity={0.6}
                    onPress={() => handleOpenDeveloperURL(DEVELOPER_EMAIL_URL)}
                  >
                    <Text style={styles.developerSocialLink}>Email</Text>
                  </TouchableOpacity>
                </View>
              </View>


              <AnimatedDropdownContent
                visible={langDropdownOpen}
                top={langRowLayout.y + langRowLayout.height - 6}
                style={[styles.dropdownMenu, cardStyle]}
              >
                {languagesList.map((item, idx) => (
                  <TouchableOpacity
                    key={item.id}
                    activeOpacity={0.7}
                    delayPressIn={50}
                    style={[
                      styles.menuItem,
                      idx > 0 && styles.menuItemDivider,
                      idx > 0 && (isDarkMode ? styles.menuItemDividerDark : styles.menuItemDividerLight),
                      language === item.id &&
                        (isDarkMode
                          ? styles.menuItemActiveDark
                          : styles.menuItemActiveLight),
                    ]}
                    onPress={() => {
                      setLanguage(item.id);
                      setLangDropdownOpen(false);
                    }}
                  >
                    <Text
                      style={[
                        styles.menuItemText,
                        themeText,
                        language === item.id && styles.menuItemTextActive,
                      ]}
                    >
                      {item.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </AnimatedDropdownContent>
              <AnimatedDropdownContent
                visible={themeDropdownOpen}
                top={themeRowLayout.y + themeRowLayout.height - 6}
                style={[styles.dropdownMenu, cardStyle]}
              >
                {[
                  { id: 'system', label: t.themeOptSystem },
                  { id: 'light', label: t.themeOptLight },
                  { id: 'dark', label: t.themeOptDark },
                ].map((item, idx) => (
                  <TouchableOpacity
                    key={item.id}
                    activeOpacity={0.7}
                    delayPressIn={50}
                    style={[
                      styles.menuItem,
                      idx > 0 && styles.menuItemDivider,
                      idx > 0 && (isDarkMode ? styles.menuItemDividerDark : styles.menuItemDividerLight),
                      themeMode === item.id &&
                        (isDarkMode
                          ? styles.menuItemActiveDark
                          : styles.menuItemActiveLight),
                    ]}
                    onPress={() => {
                      setThemeMode(item.id);
                      setThemeDropdownOpen(false);
                    }}
                  >
                    <Text
                      style={[
                        styles.menuItemText,
                        themeText,
                        themeMode === item.id && styles.menuItemTextActive,
                      ]}
                    >
                      {item.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </AnimatedDropdownContent>
            </ScrollView>
            <HeaderFade color={themeBgColor} scrollY={settingsScrollY} />
          </View>
        </Animated.View>
      )}
    </View>
  );
}

const alertStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.4)', // Finomabb háttér elhomályosítás
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  alertContainer: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: '#ffffff', // Világos háttér
    borderRadius: 20,
    padding: 20,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 8,
  },
  alertContainerDark: {
    backgroundColor: '#1e293b',
  },
  alertContainerAmoled: {
    backgroundColor: '#121212',
    borderWidth: 1,
    borderColor: '#27272a',
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#0f172a', // Sötét címsor
    textAlign: 'center',
    marginBottom: 8,
  },
  titleDark: { color: '#ffffff' },
  message: {
    fontSize: 14,
    color: '#475569', // Sötétebb szürke leírás
    textAlign: 'center',
    marginBottom: 20,
  },
  messageDark: { color: '#cbd5e1' },
  buttonContainer: {
    width: '100%',
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 10,
  },
  button: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 25, // Kapszula (pill) forma
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 100,
    flexGrow: 1,
  },
  defaultButton: {
    backgroundColor: '#2563eb', // Kék gomb
  },
  cancelButton: {
    backgroundColor: '#2563eb', // Kék gomb ("Mégse")
  },
  destructiveButton: {
    backgroundColor: '#ef4444', // Piros gomb ("Törlés")
  },
  buttonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#ffffff',
  },
  footerLinkWrap: {
    marginTop: 14,
    paddingVertical: 2,
  },
  footerLinkText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#2563eb',
    textAlign: 'center',
  },
  footerLinkTextDark: { color: '#93c5fd' },
});

const welcomeStyles = StyleSheet.create({
  container: {
    maxHeight: '86%',
    maxWidth: 360,
    padding: 0,
    overflow: 'hidden',
    alignItems: 'stretch',
  },
  scroll: {
    width: '100%',
    flexGrow: 0,
    flexShrink: 1,
  },
  scrollContent: {
    padding: 20,
    alignItems: 'center',
  },
  iconWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  versionBadge: {
    paddingVertical: 3,
    paddingHorizontal: 12,
    borderRadius: 20,
    backgroundColor: 'rgba(37, 99, 235, 0.12)',
    marginBottom: 10,
  },
  versionBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  sectionLabel: {
    alignSelf: 'flex-start',
    fontSize: 12,
    fontWeight: '700',
    color: '#64748b',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  sectionLabelDark: { color: '#94a3b8' },
  list: {
    width: '100%',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 7,
  },
  rowIcon: {
    width: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0f172a',
  },
  rowSub: {
    fontSize: 12.5,
    color: '#475569',
    marginTop: 1,
  },
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  lockScreenContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 30,
  },
  lockIconWrap: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: 'rgba(37, 99, 235, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  lockUnlockBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#2563eb',
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 14,
    marginTop: 10,
  },
  lockUnlockBtnText: {
    color: '#ffffff',
    fontWeight: 'bold',
    fontSize: 15,
  },
  centeredView: {
    flex: 1,
    backgroundColor: '#000000',
    justifyContent: 'center',
    alignItems: 'center',
  },
  bgDark: { backgroundColor: THEME_BG_COLORS.dark },
  bgAmoled: { backgroundColor: THEME_BG_COLORS.amoled },
  bgLight: { backgroundColor: THEME_BG_COLORS.light },
  textDark: { color: '#ffffff' },
  textLight: { color: '#0f172a' },

  cameraContainer: {
    flex: 1,
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT,
    backgroundColor: '#000000',
    position: 'relative',
  },
  fullScreenCamera: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT,
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  cameraOverlayWrapper: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight || 0) + 20 : 50,
    paddingBottom: 60,
  },
  closeCameraButton: {
    alignSelf: 'flex-end',
    marginRight: 20,
    width: 48,
    height: 48,
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    borderRadius: 15,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  scanTargetBox: {
    width: SCREEN_WIDTH * 0.75,
    height: SCREEN_WIDTH * 0.45,
    borderWidth: 3,
    borderColor: '#2563eb',
    borderRadius: 16,
    backgroundColor: 'transparent',
  },
  scanTargetBoxSquare: {
    width: SCREEN_WIDTH * 0.65,
    height: SCREEN_WIDTH * 0.65,
  },
  scanInstructionText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    overflow: 'hidden',
    textAlign: 'center',
  },

  settingsOverlayPanel: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 9999,
    elevation: 30,
  },

  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight || 0) + 10 : 20,
    paddingBottom: 20,
    minHeight: 75,
  },
  screenHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight || 0) + 10 : 20,
    paddingBottom: 20,
    minHeight: 75,
  },
  title: { fontSize: 28, fontWeight: '800' },
  titleWalletPart: { color: '#2563eb' },
  backBtn: {
    padding: 6,
    marginLeft: -6,
  },
  settingsIconBtn: {
    padding: 6,
    marginRight: -6,
  },
  headerActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  searchIconBtn: {
    padding: 6,
  },
  searchHeaderRow: {
    justifyContent: 'flex-start',
  },
  searchHeaderInput: {
    flex: 1,
    fontSize: 18,
    fontWeight: '600',
    marginLeft: 8,
    paddingVertical: 4,
  },
  searchClearBtn: {
    padding: 6,
    marginLeft: 4,
  },

  stackContainer: {
    position: 'relative',
    marginHorizontal: 20,
    marginTop: STACK_MARGIN_TOP,
    flex: 1,
  },
  animatedCard: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
  },
  swipeCardWrapper: {
    position: 'relative',
    justifyContent: 'center',
    flex: 1,
  },
  dragHandleZone: {
    height: CARD_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    overflow: 'hidden',
  },
  dragHandleBar: {
    width: 4,
    height: 30,
    borderRadius: 2,
    backgroundColor: '#94a3b8',
  },
  cardTouchable: {
    width: '100%',
  },
  flipCardSide: {
    width: '100%',
  },
  flipCardBackPosition: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
  deleteIconButton: {
    position: 'absolute',
    right: 4,
    top: 4,
    bottom: 4,
    width: 58,
    backgroundColor: '#ef4444',
    borderRadius: 15,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 0,
    overflow: 'hidden',

    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 2,
    borderBottomWidth: 4,
    borderTopColor: 'rgba(255, 255, 255, 0.4)',
    borderLeftColor: 'rgba(255, 255, 255, 0.2)',
    borderRightColor: 'rgba(0, 0, 0, 0.25)',
    borderBottomColor: 'rgba(0, 0, 0, 0.4)',

    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 10,
  },
  linkIconButton: {
    position: 'absolute',
    left: 4,
    top: 4,
    bottom: 4,
    width: 58,
    backgroundColor: '#2563eb',
    borderRadius: 15,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 0,
    overflow: 'hidden',

    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 2,
    borderBottomWidth: 4,
    borderTopColor: 'rgba(255, 255, 255, 0.4)',
    borderLeftColor: 'rgba(255, 255, 255, 0.2)',
    borderRightColor: 'rgba(0, 0, 0, 0.25)',
    borderBottomColor: 'rgba(0, 0, 0, 0.4)',

    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 10,
  },
  linkedIconImage: {
    width: 32,
    height: 32,
    borderRadius: 8,
  },
  walletCard: {
    height: CARD_HEIGHT,
    borderRadius: 18,
    padding: 20,
    justifyContent: 'space-between',
    position: 'relative',
    overflow: 'hidden',

    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 2,
    borderBottomWidth: 4,
    borderTopColor: 'rgba(255, 255, 255, 0.4)',
    borderLeftColor: 'rgba(255, 255, 255, 0.2)',
    borderRightColor: 'rgba(0, 0, 0, 0.25)',
    borderBottomColor: 'rgba(0, 0, 0, 0.4)',

    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 10,
  },
  cardBack: {
    justifyContent: 'center',
  },
  cardBackActionsColumn: {
    flexDirection: 'column',
    gap: 12,
    justifyContent: 'center',
    alignItems: 'stretch',
  },
  cardBackBtn: {
    width: '100%',
    flexDirection: 'row',
    backgroundColor: 'rgba(0,0,0,0.4)',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  cardBackBtnText: {
    color: '#ffffff',
    fontWeight: 'bold',
    fontSize: 14,
  },
  cardBackBtnIcon: {
    width: 18,
    height: 18,
    borderRadius: 4,
  },
  activeWalletCard: {
    borderBottomWidth: 5,
    borderRightWidth: 3,
    borderBottomColor: 'rgba(0, 0, 0, 0.5)',
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.55,
    shadowRadius: 16,
    elevation: 18,
  },
  swipeButtonHighlightEdge: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 1.5,
    backgroundColor: 'rgba(255, 255, 255, 0.5)',
  },
  cardHighlightEdge: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 1.5,
    backgroundColor: 'rgba(255, 255, 255, 0.5)',
  },
  cardTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardTopRowActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  cardName: {
    fontSize: 22,
    fontWeight: '800',
    color: '#ffffff',
    flex: 1,
    marginRight: 10,
  },
  activeBadge: {
    backgroundColor: 'rgba(255,255,255,0.3)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  activeBadgeText: { color: '#ffffff', fontSize: 10, fontWeight: 'bold' },

  codeContainer: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 6,
    alignItems: 'center',
    height: 95,
    justifyContent: 'center',
    borderBottomWidth: 2,
    borderBottomColor: '#cbd5e1',
  },
  realBarcodeWrapper: {
    height: 42,
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%',
    overflow: 'hidden',
  },
  cardCodeText: {
    marginTop: 4,
    fontSize: 12,
    fontWeight: '600',
    color: '#000000',
    letterSpacing: 2,
  },

  qrCardRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'stretch',
    justifyContent: 'space-between',
  },
  qrCardLeftCol: {
    flex: 1,
    paddingRight: 12,
    justifyContent: 'space-between',
  },
  qrSquareBox: {
    width: 140,
    height: 140,
    backgroundColor: '#ffffff',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: 2,
    borderBottomColor: '#cbd5e1',
  },
  codeContainerHidden: {
    backgroundColor: 'transparent',
    borderBottomWidth: 0,
  },
  barcodeFadeWrapper: {
    width: '100%',
    alignItems: 'center',
  },
  qrSquareBoxHidden: {
    backgroundColor: 'transparent',
    borderBottomWidth: 0,
  },
  qrCodeFadeWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  backupQrBox: {
    alignSelf: 'center',
    backgroundColor: '#ffffff',
    padding: 20,
    borderRadius: 16,
  },

  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  emptyText: { fontSize: 18, fontWeight: 'bold', textAlign: 'center' },
  emptySubText: { fontSize: 14, textAlign: 'center', marginTop: 8 },
  emptyTextDark: { color: '#94a3b8' },
  emptyTextLight: { color: '#64748b' },

  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  bottomSheetContainer: {
    maxHeight: '85%',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: Platform.OS === 'android' ? 40 : 30,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 20,
  },
  dragArea: {
    width: '100%',
  },
  dragHandle: {
    width: 40,
    height: 5,
    backgroundColor: '#94a3b8',
    borderRadius: 3,
    alignSelf: 'center',
    marginBottom: 15,
  },
  sheetHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 15,
  },

  appListItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    marginBottom: 8,
  },
  appListIcon: {
    width: 40,
    height: 40,
    borderRadius: 8,
    marginRight: 12,
  },
  appNameText: {
    fontSize: 16,
    fontWeight: '600',
    flex: 1,
  },
  appListLoadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
    gap: 12,
  },
  appListLoadingText: {
    fontSize: 14,
    opacity: 0.7,
  },

  fieldLabel: { fontSize: 14, fontWeight: '600', marginBottom: 8 },
  inputStandard: {
    height: 50,
    borderRadius: 12,
    paddingHorizontal: 15,
    fontSize: 16,
  },
  inputDark: { backgroundColor: '#1e293b', color: '#ffffff' },
  inputAmoled: { backgroundColor: '#121212', color: '#ffffff', borderWidth: 1, borderColor: '#27272a' },
  inputLight: { backgroundColor: '#e2e8f0', color: '#0f172a' },

  scanOptionsRow: { flexDirection: 'row', gap: 12, marginTop: 5 },
  scanCardInner: {
    padding: 15,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardDark: { backgroundColor: '#1e293b' },
  cardAmoled: { backgroundColor: '#121212', borderWidth: 1, borderColor: '#27272a' },
  cardLight: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  scanOptionTitle: { fontSize: 14, fontWeight: 'bold', marginTop: 8 },
  scanOptionSub: { fontSize: 12, color: '#64748b' },

  successBadge: {
    backgroundColor: '#22c55e20',
    padding: 10,
    borderRadius: 8,
    marginTop: 12,
  },
  successBadgeText: {
    color: '#22c55e',
    fontWeight: 'bold',
    textAlign: 'center',
  },
  detectedTypeDebugText: {
    color: '#22c55e99',
    fontSize: 11,
    textAlign: 'center',
    marginTop: 4,
  },

  barcodePreviewCard: {
    marginTop: 12,
    padding: 14,
    borderRadius: 14,
    alignItems: 'center',
  },
  barcodePreviewInner: {
    width: '100%',
    minHeight: 60,
    marginTop: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
    backgroundColor: '#ffffff',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },

  palette: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 10,
  },
  colorCircle: { width: 34, height: 34, borderRadius: 17 },

  actionButtonRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 30,
    marginBottom: 20,
  },
  btnCancel: {
    height: 50,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#ef4444',
  },
  cancelText: { color: '#ef4444', fontWeight: 'bold' },
  btnSaveStandard: {
    height: 50,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  btnSaveDark: { backgroundColor: '#2563eb' },
  btnSaveLight: { backgroundColor: '#2563eb' },
  textSaveDark: { color: '#ffffff', fontWeight: 'bold', fontSize: 16 },
  textSaveLight: { color: '#ffffff', fontWeight: 'bold', fontSize: 16 },

  standardFab: {
    position: 'absolute',
    right: 20,
    bottom: 55,
    width: 60,
    height: 60,
    borderRadius: 18,
    backgroundColor: '#2563eb',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 6,
  },

  sectionHeader: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 10,
    marginTop: 10,
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderRadius: 14,
  },
  brightnessLevelRow: {
    flexDirection: 'column',
    alignItems: 'stretch',
  },
  brightnessLevelLabelsRow: {
    flexDirection: 'row',
    marginTop: 8,
    paddingHorizontal: 2,
  },
  // Három egyenlő szélességű harmad: így a középső felirat pontosan a sáv
  // közepén, a fogantyú középső fázisával szimmetrikusan jelenik meg,
  // a szélső feliratok pedig a széleknél maradnak, a szövegük hosszától
  // függetlenül.
  brightnessLevelLabelLeft: {
    flex: 1,
    textAlign: 'left',
  },
  brightnessLevelLabelCenter: {
    flex: 1,
    textAlign: 'center',
  },
  brightnessLevelLabelRight: {
    flex: 1,
    textAlign: 'right',
  },
  settingRowOpen: {
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
  },
  backupIconWrap: {
    width: 20,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  settingTitle: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  settingSub: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 2,
  },
  dropdownContainer: { width: '100%' },
  dropdownMenu: {
    borderTopLeftRadius: 0,
    borderTopRightRadius: 0,
    borderBottomLeftRadius: 14,
    borderBottomRightRadius: 14,
    paddingTop: 6,
    overflow: 'hidden',
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  menuItem: { paddingVertical: 14, paddingHorizontal: 16 },
  menuItemDivider: { borderTopWidth: StyleSheet.hairlineWidth },
  menuItemDividerDark: { borderTopColor: '#334155' },
  menuItemDividerLight: { borderTopColor: '#e2e8f0' },
  menuItemActiveDark: { backgroundColor: '#28354a' },
  menuItemActiveLight: { backgroundColor: '#e8eef9' },
  menuItemText: { fontSize: 15, fontWeight: '500' },
  menuItemTextActive: { fontWeight: 'bold', color: '#2563eb' },

  developerCard: {
    padding: 16,
    borderRadius: 14,
    gap: 15,
  },
  developerInfo: {
    flexDirection: 'column',
  },
  developerSub: {
    fontSize: 12,
    color: '#64748b',
  },
  developerName: {
    fontSize: 18,
    fontWeight: '800',
    marginTop: 2,
  },
  developerSocialColumn: {
    flexDirection: 'column',
    gap: 10,
  },
  developerSocialLink: {
    color: '#2563eb',
    fontSize: 15,
    fontWeight: '700',
  },
});