port module CrashesOnLoad exposing (main)


port output : Int -> Cmd msg


{-| Elm computes a top-level value when the compiled code loads, so this one
fails before any module starts.
-}
broken : Int
broken =
    Debug.todo "a top-level value that fails"


main : Program () () ()
main =
    Platform.worker
        { init = \_ -> ( (), output broken )
        , update = \_ model -> ( model, Cmd.none )
        , subscriptions = \_ -> Sub.none
        }
