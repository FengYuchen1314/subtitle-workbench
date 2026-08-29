package dev.subtitle.workbench;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override public void onCreate(android.os.Bundle savedInstanceState) {
        registerPlugin(SubtitleEnginePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
