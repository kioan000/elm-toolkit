port module Greeter exposing (main)


port greeting : String -> Cmd msg


main : Program String () ()
main =
    Platform.worker
        { init = \name -> ( (), greeting ("Hello, " ++ name) )
        , update = \_ model -> ( model, Cmd.none )
        , subscriptions = \_ -> Sub.none
        }
